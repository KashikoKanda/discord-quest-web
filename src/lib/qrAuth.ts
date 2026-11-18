/**
 * Discord QR Code Login (Remote Auth — DESKTOP flow)
 *
 * Reference: https://docs.discord.food/remote-authentication/desktop
 *
 * Flow:
 *   1. Generate RSA-2048 keypair (OAEP/SHA-256)
 *   2. Open WebSocket to wss://remote-auth-gateway.discord.gg/?v=2
 *      (must send Origin: https://discord.com)
 *   3. Receive {"op":"hello","heartbeat_interval":41250,"timeout_ms":142637}
 *      Start heartbeat loop.
 *   4. Send {"op":"init","encoded_public_key":"<base64-spki-pubkey>"}
 *   5. Receive {"op":"nonce_proof","encrypted_nonce":"<base64 RSA-OAEP/SHA-256 encrypted nonce>"}
 *      Decrypt the nonce with our private key.
 *      Base64URL-encode the decrypted nonce (stripped of '=' padding).
 *      Send back {"op":"nonce_proof","nonce":"<base64URL>"}
 *   6. Receive {"op":"pending_remote_init","fingerprint":"<short base64URL>"}
 *      → The QR encodes https://discord.com/ra/<fingerprint>
 *      → Generate QR PNG ourselves with the `qrcode` lib.
 *   7. Receive {"op":"pending_ticket","encrypted_user_payload":"..."}
 *      Optional: decrypt to get user info (id:discriminator:avatar:username).
 *   8. Receive {"op":"pending_login","ticket":"<ticket>"}
 *   9. POST https://discord.com/api/v9/users/@me/remote-auth/login  {"ticket":"..."}
 *      Response: {"encrypted_token":"<base64 RSA-OAEP/SHA-256 encrypted>"}
 *      Decrypt to get the user's auth token.
 *
 * Robustness:
 *   - WS connection retries up to 3 times with different header configurations
 *     (Cloudflare may intermittently block certain header combinations).
 *   - Detailed logs are kept per-session and surfaced to the frontend via /poll.
 */

import crypto from "node:crypto";
import WebSocket from "ws";
import QRCode from "qrcode";
import { getBuildVersion } from "./discord";
import { pickRandomUA, buildSuperProperties, buildDiscordHeaders, buildWsOptions, type UABundle } from "./uaPool";
import { fetchWithProxy, getWsProxyAgent } from "./proxyHelper";

export type QRState =
  | "pending_scan"      // QR displayed, waiting for scan
  | "pending_confirm"   // User scanned, waiting for tap "Yes" on mobile
  | "captcha_required"  // Discord asked for hCaptcha on the ticket exchange
  | "success"           // Got token, decrypted
  | "expired"           // WS closed / timed out / cancelled
  | "error";            // Unexpected error

export interface QRRawLog {
  ts: number;
  level: "info" | "warn" | "error" | "success";
  message: string;
}

/** Discord captcha challenge returned by /remote-auth/login. */
export interface QRCaptcha {
  sitekey: string;
  rqdata?: string;
  rqtoken?: string;
  sessionId?: string;
}

export class CaptchaRequiredError extends Error {
  captcha: QRCaptcha;
  constructor(captcha: QRCaptcha) {
    super("captcha-required");
    this.name = "CaptchaRequiredError";
    this.captcha = captcha;
  }
}

export interface QRSession {
  sessionId: string;
  publicKeyB64: string;        // SPKI base64
  qrImage: string | null;      // data:image/png;base64,...
  qrFingerprint: string | null; // The short ID encoded in the QR (https://discord.com/ra/<fp>)
  state: QRState;
  token: string | null;        // Discord auth token (on success)
  errorMessage: string | null;
  createdAt: number;
  lastActivity: number;
  ws: WebSocket | null;
  heartbeatTimer: NodeJS.Timeout | null;
  cleanupTimer: NodeJS.Timeout | null;
  /** Chronological log of all session events — surfaced to frontend on poll. */
  logs: QRRawLog[];
  /** RSA private key — kept so a captcha retry can still decrypt the token. */
  privateKey: crypto.KeyObject | null;
  /** Ticket from pending_login, reused when retrying after a captcha. */
  pendingTicket: string | null;
  /** Current captcha challenge, when Discord is asking for one. */
  captcha: QRCaptcha | null;
}

const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes max
const WS_URL = "wss://remote-auth-gateway.discord.gg/?v=2";

const sessions = new Map<string, QRSession>();

function genId(): string {
  return `qr_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Convert Buffer to base64URL (RFC 4648 §5) — no padding. */
function toBase64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Append a log entry to the session (capped at 50 most recent). */
function pushLog(sess: QRSession, level: QRRawLog["level"], message: string) {
  sess.logs.push({ ts: Date.now(), level, message });
  if (sess.logs.length > 50) sess.logs = sess.logs.slice(-50);
  const prefix = level === "error" ? "[QRAuth ERROR]"
    : level === "warn" ? "[QRAuth WARN]"
    : level === "success" ? "[QRAuth OK]"
    : "[QRAuth]";
  console.log(`${prefix} ${sess.sessionId}: ${message}`);
}

/**
 * Build x-super-properties header (used for HTTP API calls only — NOT for WS).
 */
/** Pick a random UA + build x-super-properties for HTTP API calls.
 *  Each call returns a fresh UA bundle (Chrome version + OS + arch + language
 *  random) so consecutive requests don't share the same fingerprint. */
function pickRandomUABundle(): { ua: UABundle; superProps: string } {
  const ua = pickRandomUA();
  const { superProps } = buildSuperProperties(ua);
  return { ua, superProps };
}

/** Generate RSA-2048 keypair. */
function generateKeyPair(): { publicKeyB64: string; privateKey: crypto.KeyObject } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const spki = publicKey.export({ type: "spki", format: "der" });
  return {
    publicKeyB64: spki.toString("base64"),
    privateKey,
  };
}

/** Decrypt payload encrypted with our RSA public key (RSA-OAEP, SHA-256). */
function decryptWithPrivateKey(privateKey: crypto.KeyObject, encryptedB64: string): Buffer {
  const buf = Buffer.from(encryptedB64, "base64");
  return crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    buf,
  );
}

/** Generate a QR code PNG (data URL) from discord.com/ra/<fingerprint>. */
async function generateQrPng(fingerprint: string): Promise<string> {
  const url = `https://discord.com/ra/${fingerprint}`;
  const pngBuffer = await QRCode.toBuffer(url, {
    type: "png",
    margin: 1,
    width: 256,
    color: { dark: "#000000", light: "#FFFFFF" },
    errorCorrectionLevel: "M",
  });
  return `data:image/png;base64,${pngBuffer.toString("base64")}`;
}

/** POST /users/@me/remote-auth/login to exchange ticket for encrypted token.
 *  Uses a fresh random UA per call + proxy pool to avoid IP rate-limit.
 *  If Discord answers 400 with captcha-required, throws CaptchaRequiredError so
 *  the caller can show the challenge and retry with the solved hCaptcha token. */
async function exchangeTicketForToken(
  ticket: string,
  captchaToken?: string,
  captchaData?: QRCaptcha | null,
): Promise<string> {
  const { ua, superProps } = pickRandomUABundle();
  const headers = buildDiscordHeaders(ua, superProps);

  const body: Record<string, unknown> = { ticket };
  if (captchaToken) {
    // Discord expects captcha_key as an array; rqdata/rqtoken must come from the
    // challenge so the solved token is bound to this exact captcha request.
    body.captcha_key = [captchaToken];
    if (captchaData?.rqdata) body.captcha_rqdata = captchaData.rqdata;
    if (captchaData?.rqtoken) body.captcha_rqtoken = captchaData.rqtoken;
  }

  // Sử dụng proxy pool — tránh IP server bị Discord rate-limit
  const res = await fetchWithProxy("https://discord.com/api/v9/users/@me/remote-auth/login", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const txt = await res.text().catch(() => "");

  if (!res.ok) {
    try {
      const parsed = JSON.parse(txt) as {
        captcha_key?: string[];
        captcha_sitekey?: string;
        captcha_rqdata?: string;
        captcha_rqtoken?: string;
        captcha_session_id?: string;
      };
      if (Array.isArray(parsed?.captcha_key) && parsed.captcha_key.includes("captcha-required")) {
        throw new CaptchaRequiredError({
          sitekey: parsed.captcha_sitekey || "",
          rqdata: parsed.captcha_rqdata,
          rqtoken: parsed.captcha_rqtoken,
          sessionId: parsed.captcha_session_id,
        });
      }
    } catch (e) {
      if (e instanceof CaptchaRequiredError) throw e;
    }
    throw new Error(`remote-auth/login ${res.status}: ${txt}`);
  }

  let data: { encrypted_token?: string } = {};
  try { data = JSON.parse(txt) as { encrypted_token?: string }; } catch { /* fall through */ }
  if (!data.encrypted_token) {
    throw new Error("remote-auth/login: missing encrypted_token");
  }
  return data.encrypted_token;
}

function cleanupSession(sessionId: string, reason: string) {
  const sess = sessions.get(sessionId);
  if (!sess) return;
  if (sess.heartbeatTimer) clearInterval(sess.heartbeatTimer);
  if (sess.cleanupTimer) clearTimeout(sess.cleanupTimer);
  try { sess.ws?.close(); } catch { /* ignore */ }
  sess.ws = null;
  sess.heartbeatTimer = null;
  sess.cleanupTimer = null;
  console.log(`[QRAuth] Cleanup session ${sessionId} (${reason})`);
  sess.state = sess.state === "success" ? "success" : "expired";
  // Remove after 30s so the client can fetch the final state
  setTimeout(() => sessions.delete(sessionId), 30_000);
}

/**
 * Open WebSocket with browser-like headers.
 * Tries up to 3 different header configurations if the first one fails
 * (Cloudflare may rate-limit or block certain header combinations).
 */
function openWebSocket(session: QRSession): Promise<WebSocket> {
  return new Promise(async (resolveWS, rejectWS) => {
    // ─── Lấy proxy agent ngẫu nhiên từ pool để tránh IP server rate-limit ───
    // Discord remote-auth-gateway cũng flag IP server nếu nhiều user dùng chung
    const { agent: wsProxyAgent, proxy: wsProxy } = await getWsProxyAgent();
    if (wsProxy) {
      pushLog(session, "info", `Using proxy: ${wsProxy.countryCode || "?"} ${wsProxy.host}:${wsProxy.port}`);
    } else {
      pushLog(session, "warn", "No proxy available — using direct connection (may get rate-limited)");
    }

    // ─── 3 random UA bundles — mỗi attempt dùng UA khác nhau để tránh fingerprint spam ───
    // Config 1: full browser-like (UA + Accept-Language + Accept-Encoding +
    // Cache-Control + Pragma + Sec-CH-UA high-entropy hints + perMessageDeflate)
    const ua1 = pickRandomUA();
    const config1 = { ...buildWsOptions(ua1), ...(wsProxyAgent ? { agent: wsProxyAgent } : {}) };
    // Config 2: minimal (just Origin + UA + sec-ch-ua) — fallback if full headers rejected
    const ua2 = pickRandomUA();
    const config2 = {
      origin: "https://discord.com" as const,
      headers: {
        "User-Agent": ua2.userAgent,
        "sec-ch-ua": ua2.secChUa,
        "sec-ch-ua-mobile": ua2.secChUaMobile,
        "sec-ch-ua-platform": ua2.secChUaPlatform,
      },
      handshakeTimeout: 8_000,
      ...(wsProxyAgent ? { agent: wsProxyAgent } : {}),
    };
    // Config 3: with Discord super-properties (in case gateway expects them)
    const ua3 = pickRandomUA();
    const { superProps: sp3 } = buildSuperProperties(ua3);
    const config3 = {
      origin: "https://discord.com" as const,
      headers: {
        "User-Agent": ua3.userAgent,
        "sec-ch-ua": ua3.secChUa,
        "sec-ch-ua-mobile": ua3.secChUaMobile,
        "sec-ch-ua-platform": ua3.secChUaPlatform,
        "x-super-properties": sp3,
        "x-discord-locale": "en-US",
      },
      handshakeTimeout: 8_000,
      ...(wsProxyAgent ? { agent: wsProxyAgent } : {}),
    };
    const configs = [
      { cfg: config1, ua: ua1, label: "full+deflate" },
      { cfg: config2, ua: ua2, label: "minimal" },
      { cfg: config3, ua: ua3, label: "+super-props" },
    ];
    let attemptIdx = 0;
    const tryNext = () => {
      if (attemptIdx >= configs.length) {
        rejectWS(new Error(`All ${configs.length} WS connection attempts failed`));
        return;
      }
      const { cfg, ua, label } = configs[attemptIdx];
      attemptIdx++;
      const chromeMajor = ua.chromeVersion.split(".")[0];
      pushLog(session, "info", `WS attempt ${attemptIdx}/${configs.length} (${label}, Chrome ${chromeMajor}, OS ${ua.osVersion})`);
      let settled = false;
      let wsTry: WebSocket;
      try {
        wsTry = new WebSocket(WS_URL, cfg);
      } catch (err: any) {
        pushLog(session, "error", `WS constructor failed on attempt ${attemptIdx}: ${err.message}`);
        setTimeout(tryNext, 200);
        return;
      }
      const openHandler = () => {
        if (settled) return;
        settled = true;
        pushLog(session, "success", `WebSocket connected on attempt ${attemptIdx} (${label}, Chrome ${chromeMajor})`);
        // Remove temp listeners
        wsTry.removeAllListeners("error");
        wsTry.removeAllListeners("unexpected-response");
        resolveWS(wsTry);
      };
      const errHandler = (err: Error) => {
        if (settled) return;
        settled = true;
        pushLog(session, "warn", `WS attempt ${attemptIdx} failed: ${err.message}`);
        try { wsTry.close(); } catch { /* ignore */ }
        setTimeout(tryNext, 200);
      };
      const unexpectedHandler = (_req: any, res: any) => {
        // 101 Switching Protocols = WS upgrade accepted by server.
        // In some Node.js versions / network configs, the http client emits
        // the `response` event (instead of `upgrade`) for 101 responses.
        // The ws library then fires `unexpected-response` even though the
        // upgrade was actually accepted. We must NOT treat this as a failure
        // — wait for the `open` event to fire (which happens when the ws
        // library completes the WS handshake).
        if (res.statusCode === 101) {
          pushLog(session, "info", `WS attempt ${attemptIdx} → HTTP 101 (handshake accepted, waiting for open)`);
          // Drain response body to free the socket
          try { res.resume(); } catch { /* ignore */ }
          // Start a 3s fallback — if `open` doesn't fire, move to next attempt
          setTimeout(() => {
            if (!settled) {
              settled = true;
              pushLog(session, "warn", `WS attempt ${attemptIdx} → 101 received but open event never fired (3s timeout)`);
              try { wsTry.close(); } catch { /* ignore */ }
              setTimeout(tryNext, 200);
            }
          }, 3000);
          return;  // DON'T settle — let `open` handler fire
        }
        if (settled) return;
        settled = true;
        pushLog(session, "warn", `WS attempt ${attemptIdx} → HTTP ${res.statusCode} ${res.statusMessage}`);
        // Drain response to free the socket
        try { res.resume(); } catch { /* ignore */ }
        try { wsTry.close(); } catch { /* ignore */ }
        setTimeout(tryNext, 200);
      };
      wsTry.once("open", openHandler);
      wsTry.once("error", errHandler);
      wsTry.once("unexpected-response", unexpectedHandler);
    };
    tryNext();
  });
}

/**
 * Start a new QR auth session.
 */
export async function startQRSession(): Promise<{
  sessionId: string;
  state: QRState;
  qrImage: string | null;
  publicKeyB64: string;
}> {
  const { publicKeyB64, privateKey } = generateKeyPair();
  const sessionId = genId();

  const session: QRSession = {
    sessionId,
    publicKeyB64,
    qrImage: null,
    qrFingerprint: null,
    state: "pending_scan",
    token: null,
    errorMessage: null,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    ws: null,
    heartbeatTimer: null,
    cleanupTimer: null,
    logs: [],
    privateKey,
    pendingTicket: null,
    captcha: null,
  };
  sessions.set(sessionId, session);
  pushLog(session, "info", `Session created — RSA-2048 keypair generated (pubkey ${publicKeyB64.length}B base64)`);

  return new Promise((resolve) => {
    let resolved = false;
    const resolvePending = () => {
      if (resolved) return;
      resolved = true;
      resolve({
        sessionId,
        state: session.state,
        qrImage: session.qrImage,
        publicKeyB64,
      });
    };
    // Resolve after 3.5s (or sooner on pending_remote_init) so client gets session ID fast
    const earlyResolveTimer = setTimeout(resolvePending, 3500);

    // Kick off WebSocket connection with retry logic
    openWebSocket(session)
      .then((openedWs: WebSocket) => {
        session.ws = openedWs;
        attachWsHandlers(openedWs);
        // The "open" event has already fired inside openWebSocket() before
        // attachWsHandlers could register a listener, so we call the open
        // handler explicitly here.
        handleWsOpen(openedWs);
      })
      .catch((err: any) => {
        pushLog(session, "error", `All WS connection attempts failed: ${err.message}`);
        session.state = "error";
        session.errorMessage = `WebSocket connection failed: ${err.message}`;
        clearTimeout(earlyResolveTimer);
        resolvePending();
      });

    /** Logic to run when WS opens — send init op + start TTL cleanup. */
    function handleWsOpen(ws: WebSocket) {
      pushLog(session, "info", "WebSocket open — sending init op");
      try {
        ws.send(JSON.stringify({ op: "init", encoded_public_key: publicKeyB64 }));
        pushLog(session, "info", `Sent init op with encoded_public_key (${publicKeyB64.length}B)`);
      } catch (err: any) {
        pushLog(session, "error", `Failed to send init: ${err.message}`);
      }
      // Auto-cleanup after TTL
      session.cleanupTimer = setTimeout(() => {
        pushLog(session, "warn", `Session TTL reached (${SESSION_TTL_MS / 1000}s) — auto-closing`);
        cleanupSession(sessionId, "TTL expired");
      }, SESSION_TTL_MS);
    }

    /**
     * Attach WS event handlers (message/error/close) to the connected WS.
     * Note: "open" handler is NOT registered here — the WS is already open
     * by the time we attach, so we call handleWsOpen() directly above.
     */
    function attachWsHandlers(ws: WebSocket) {
      ws.on("message", async (raw: Buffer | string) => {
        let msg: any;
        try {
          msg = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8"));
        } catch {
          return;
        }
        session.lastActivity = Date.now();

        switch (msg.op) {
          case "hello": {
            const interval = msg.heartbeat_interval || 41250;
            const timeoutMs = msg.timeout_ms || 142637;
            pushLog(session, "info", `Received hello — heartbeat_interval=${interval}ms, timeout=${Math.round(timeoutMs / 1000)}s`);
            if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
            const hbInterval = Math.min(interval, 5000);
            const jitter = Math.floor(Math.random() * Math.min(hbInterval, 1500));
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(JSON.stringify({ op: "heartbeat" })); } catch { /* ignore */ }
              }
              session.heartbeatTimer = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                  try { ws.send(JSON.stringify({ op: "heartbeat" })); } catch { /* ignore */ }
                }
              }, hbInterval);
            }, jitter);
            break;
          }

          case "heartbeat_ack":
            // Server acknowledged our heartbeat — all good (no log to avoid spam)
            break;

          case "nonce_proof": {
            try {
              const encryptedNonce = msg.encrypted_nonce;
              if (!encryptedNonce) {
                throw new Error("missing encrypted_nonce field");
              }
              pushLog(session, "info", `Received nonce_proof — encrypted ${encryptedNonce.length}B base64`);
              const decrypted = decryptWithPrivateKey(privateKey, encryptedNonce);
              const nonceB64Url = toBase64Url(decrypted);
              ws.send(JSON.stringify({ op: "nonce_proof", nonce: nonceB64Url }));
              pushLog(session, "success", `Sent nonce_proof — decrypted ${decrypted.length}B → b64url ${nonceB64Url.length} chars`);
            } catch (err: any) {
              pushLog(session, "error", `Nonce proof failed: ${err.message}`);
              session.state = "error";
              session.errorMessage = `Nonce proof: ${err.message}`;
              clearTimeout(earlyResolveTimer);
              resolvePending();
            }
            break;
          }

          case "pending_remote_init": {
            const fingerprint = String(msg.fingerprint || "");
            if (!fingerprint) {
              pushLog(session, "warn", "pending_remote_init received but missing fingerprint");
              break;
            }
            pushLog(session, "success", `Handshake accepted — fingerprint: ${fingerprint}`);
            session.qrFingerprint = fingerprint;
            session.state = "pending_scan";
            try {
              const pngDataUrl = await generateQrPng(fingerprint);
              session.qrImage = pngDataUrl;
              pushLog(session, "info", `Generated QR PNG (256×256) — encoding https://discord.com/ra/${fingerprint.slice(0, 8)}...`);
            } catch (err: any) {
              pushLog(session, "error", `QR generation failed: ${err.message}`);
              session.state = "error";
              session.errorMessage = `QR generation: ${err.message}`;
            }
            clearTimeout(earlyResolveTimer);
            resolvePending();
            break;
          }

          case "pending_ticket": {
            try {
              if (msg.encrypted_user_payload) {
                const payload = decryptWithPrivateKey(privateKey, msg.encrypted_user_payload).toString("utf8");
                const parts = payload.split(":");
                if (parts.length >= 4) {
                  pushLog(session, "success", `QR scanned by ${parts[3]} (id ${parts[0]}) — awaiting confirmation on mobile`);
                } else {
                  pushLog(session, "info", `QR scanned — pending mobile confirmation`);
                }
              } else {
                pushLog(session, "info", "QR scanned — pending mobile confirmation");
              }
            } catch {
              pushLog(session, "info", "QR scanned — pending mobile confirmation (could not decrypt user payload)");
            }
            session.state = "pending_confirm";
            resolvePending();
            break;
          }

          case "pending_login": {
            try {
              const ticket = String(msg.ticket || "");
              if (!ticket) {
                throw new Error("pending_login: missing ticket");
              }
              pushLog(session, "info", `Mobile confirmed — got ticket (${ticket.length} chars), exchanging for token...`);
              session.pendingTicket = ticket;
              const encryptedToken = await exchangeTicketForToken(ticket);
              const token = decryptWithPrivateKey(privateKey, encryptedToken).toString("utf8");
              session.token = token;
              session.state = "success";
              pushLog(session, "success", `Token decrypted successfully (${token.length} chars) — login complete`);
              setTimeout(() => cleanupSession(sessionId, "success"), 5_000);
            } catch (err: any) {
              if (err instanceof CaptchaRequiredError) {
                // Discord wants a human to solve hCaptcha before handing over the token.
                session.state = "captcha_required";
                session.captcha = err.captcha;
                session.lastActivity = Date.now();
                pushLog(session, "warn", "Discord yêu cầu captcha (hCaptcha) — chờ người dùng giải");
                // Keep the session (and its RSA key + ticket) alive long enough to solve.
                if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
                session.cleanupTimer = setTimeout(
                  () => cleanupSession(sessionId, "captcha-timeout"),
                  4 * 60 * 1000,
                );
              } else {
                pushLog(session, "error", `Token exchange failed: ${err.message}`);
                session.state = "error";
                session.errorMessage = `Token exchange: ${err.message}`;
                setTimeout(() => cleanupSession(sessionId, "token-exchange-failed"), 5_000);
              }
            }
            resolvePending();
            break;
          }

          case "cancel":
            pushLog(session, "warn", "Mobile client cancelled authentication");
            session.state = "expired";
            session.errorMessage = "Người dùng đã hủy trên điện thoại";
            setTimeout(() => cleanupSession(sessionId, "cancel"), 5_000);
            resolvePending();
            break;

          case "error":
            pushLog(session, "error", `Server error: ${msg.message || "unknown"}`);
            session.state = "error";
            session.errorMessage = msg.message || "Server error";
            setTimeout(() => cleanupSession(sessionId, "error"), 5_000);
            resolvePending();
            break;

          default:
            pushLog(session, "warn", `Unknown op received: ${msg.op}`);
        }
      });

      ws.on("error", (err: Error) => {
        pushLog(session, "error", `WebSocket error: ${err.message}`);
        if (session.state === "pending_scan" || session.state === "pending_confirm") {
          session.state = "error";
          session.errorMessage = err.message;
        }
        clearTimeout(earlyResolveTimer);
        resolvePending();
      });

      ws.on("close", (code: number, reason: Buffer) => {
        const reasonStr = reason.toString() || "(no reason)";
        const codeMap: Record<number, string> = {
          1000: "Normal closure (success/cancel)",
          1005: "No status code received",
          1006: "Abnormal closure (connection lost without close frame)",
          4000: "Invalid version",
          4001: "Decode error (invalid payload)",
          4002: "Handshake failure",
          4003: "Timeout (no scan/confirm in time)",
        };
        const explain = codeMap[code] || "Unknown close code";
        pushLog(session, code === 1000 ? "info" : "error", `WebSocket closed — code ${code} (${explain}) — ${reasonStr}`);

        if (session.state !== "success") {
          if (code === 4003) {
            session.state = "expired";
            session.errorMessage = `QR session timeout (code 4003) — Discord đóng WS sau ${Math.round(SESSION_TTL_MS / 1000)}s không có activity`;
          } else if (code === 4002) {
            session.state = "error";
            session.errorMessage = `Handshake thất bại (code 4002) — có thể do khóa RSA hoặc nonce_proof sai`;
          } else if (code === 1006) {
            session.state = "error";
            session.errorMessage = `Kết nối bị ngắt bất thường (code 1006) — có thể do Cloudflare block hoặc network issue`;
          } else if (code === 1000) {
            if (session.state !== "success") {
              session.state = "expired";
              session.errorMessage = "Phiên kết thúc bình thường (code 1000)";
            }
          } else {
            session.state = "expired";
            session.errorMessage = `WS closed (code ${code}): ${explain}`;
          }
        }
        if (session.heartbeatTimer) clearInterval(session.heartbeatTimer);
        clearTimeout(earlyResolveTimer);
        resolvePending();
      });
    }
  });
}

export function getQRSession(sessionId: string): QRSession | null {
  return sessions.get(sessionId) || null;
}

/**
 * Get the public-facing state (no internal fields).
 */
export function getQRSessionState(sessionId: string): {
  state: QRState;
  qrImage: string | null;
  token: string | null;
  errorMessage: string | null;
  captcha: QRCaptcha | null;
  logs: QRRawLog[];
} | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  return {
    state: s.state,
    qrImage: s.qrImage,
    token: s.token,
    errorMessage: s.errorMessage,
    captcha: s.captcha,
    logs: s.logs.slice(-20),
  };
}

/**
 * Retry the ticket exchange with an hCaptcha token solved by the user.
 * Returns the decrypted Discord token on success, or a fresh captcha
 * challenge if Discord rejects the solution.
 */
export async function submitQRCaptcha(
  sessionId: string,
  captchaToken: string,
): Promise<
  | { ok: true; token: string }
  | { ok: false; captcha?: QRCaptcha; error?: string }
> {
  const s = sessions.get(sessionId);
  if (!s) return { ok: false, error: "Phiên QR đã hết hạn — tạo mã mới" };
  if (!s.pendingTicket) return { ok: false, error: "Chưa có ticket — quét lại mã QR" };
  if (!s.privateKey) return { ok: false, error: "Thiếu khóa phiên — tạo mã mới" };

  s.lastActivity = Date.now();
  try {
    const encrypted = await exchangeTicketForToken(s.pendingTicket, captchaToken, s.captcha);
    const token = decryptWithPrivateKey(s.privateKey, encrypted).toString("utf8");
    s.token = token;
    s.state = "success";
    s.captcha = null;
    s.pendingTicket = null;
    pushLog(s, "success", `Captcha OK — token decrypted (${token.length} chars)`);
    setTimeout(() => cleanupSession(sessionId, "success"), 5_000);
    return { ok: true, token };
  } catch (err: any) {
    if (err instanceof CaptchaRequiredError) {
      s.captcha = err.captcha;
      s.state = "captcha_required";
      pushLog(s, "warn", "Captcha bị Discord từ chối — hiện lại thử thách");
      return { ok: false, captcha: err.captcha, error: "captcha-required" };
    }
    pushLog(s, "error", `Captcha retry failed: ${err.message}`);
    s.state = "error";
    s.errorMessage = `Token exchange: ${err.message}`;
    setTimeout(() => cleanupSession(sessionId, "token-exchange-failed"), 5_000);
    return { ok: false, error: err.message };
  }
}

export function cancelQRSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  try {
    if (s.ws?.readyState === WebSocket.OPEN) {
      s.ws.send(JSON.stringify({ op: "cancel" }));
    }
  } catch { /* ignore */ }
  cleanupSession(sessionId, "user-cancel");
}

/** Periodic sweep — remove stale sessions older than TTL. */
export function sweepStaleSessions(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActivity > SESSION_TTL_MS && s.state !== "success") {
      cleanupSession(id, "stale");
    }
  }
}

if (typeof setInterval !== "undefined") {
  setInterval(sweepStaleSessions, 60_000).unref?.();
}

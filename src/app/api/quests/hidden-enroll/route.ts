import { NextRequest, NextResponse } from "next/server";
import { QuestWorker } from "@/lib/questWorker";
import { assignProxy } from "@/lib/proxyPool";
import { buildSuperProperties } from "@/lib/discord";
import { isGatewayReady, getSuperProperties, getUserAgent } from "@/lib/gateway";
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";

const DISCORD_API = "https://discord.com/api/v10";

/**
 * Parse Discord API error response thành message tiếng Việt có ý nghĩa
 * Phân biệt giữa: tài khoản không đủ điều kiện, quest không tồn tại, đã nhận, giới hạn vùng miền, v.v.
 */
function parseDiscordError(statusCode: number, body: string): { code: number; message: string } {
  let discordCode = 0;
  let discordMessage = "";
  try {
    const parsed = JSON.parse(body);
    discordCode = parsed.code || 0;
    discordMessage = parsed.message || "";
  } catch {}

  // 260008: Unknown Quest — quest không tồn tại hoặc tài khoản không thể thấy
  if (discordCode === 260008 || statusCode === 404) {
    return { code: 260008, message: "Quest không tồn tại hoặc tài khoản không đủ điều kiện để nhận quest này" };
  }

  // 40001: Unauthorized / tài khoản chưa xác minh
  if (discordCode === 40001 || statusCode === 401) {
    return { code: 40001, message: "Token không hợp lệ hoặc đã hết hạn" };
  }

  // 50001: Missing Access — tài khoản không có quyền
  if (discordCode === 50001) {
    return { code: 50001, message: "Tài khoản không có quyền nhận quest này" };
  }

  // 50000: Quest enrollment blocked — tài khoản bị chặn nhận quest
  if (discordCode === 50000) {
    if (discordMessage.toLowerCase().includes("enrollment")) {
      return { code: 50000, message: "Tài khoản bị chặn nhận quest — có thể do vi phạm điều khoản" };
    }
    return { code: 50000, message: `Lỗi Discord: ${discordMessage || "Lỗi không xác định"}` };
  }

  // 403: Forbidden — tài khoản không đủ điều kiện (tuổi, vùng miền, v.v.)
  if (statusCode === 403) {
    if (discordMessage.toLowerCase().includes("age") || discordMessage.toLowerCase().includes("age_gate")) {
      return { code: 403, message: "Tài khoản chưa đủ tuổi để nhận quest này" };
    }
    if (discordMessage.toLowerCase().includes("region") || discordMessage.toLowerCase().includes("country")) {
      return { code: 403, message: "Quest không khả dụng ở vùng miền của tài khoản" };
    }
    return { code: 403, message: "Tài khoản không đủ điều kiện nhận quest này" };
  }

  // 400: Bad Request — thiếu dữ liệu hoặc request không hợp lệ
  if (statusCode === 400) {
    return { code: 400, message: `Yêu cầu không hợp lệ: ${discordMessage || "thiếu dữ liệu"}` };
  }

  // 429: Rate limited
  if (statusCode === 429) {
    return { code: 429, message: "Quá nhiều yêu cầu, vui lòng thử lại sau" };
  }

  // Fallback — trả về lỗi gốc
  return { code: discordCode || statusCode, message: `${statusCode} ${discordMessage || body.slice(0, 150)}` };
}

/**
 * Helper: HTTPS request qua proxy dùng node:https + HttpsProxyAgent
 * Tự set Content-Length cho body — đảm bảo Discord không trả 404
 */
function proxiedRequest(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeout?: number;
  },
  agent: https.Agent
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method,
      headers: {
        ...options.headers,
        ...(options.body ? { "Content-Length": Buffer.byteLength(options.body).toString() } : {}),
      },
      agent,
      timeout: options.timeout || 30000,
    };

    const req = https.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timeout"));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * POST /api/quests/hidden-enroll
 *
 * Sử dụng ProxyPool manager:
 * - 1 token = 1 SID proxy / quốc gia
 * - Token có thể giữ nhiều SID cho các quốc gia khác nhau
 * - Proxy tự trả về kho sau 5 phút không dùng
 */
export async function POST(request: NextRequest) {
  try {
    const { token, questId, countryCode, tokenId: clientTokenId, isMobile, questData } = await request.json();

    if (!token || !questId || !countryCode) {
      return NextResponse.json({ error: "Thiếu token, questId hoặc countryCode" }, { status: 400 });
    }

    const tokenId = clientTokenId || `t_${token.slice(0, 16)}`;
    QuestWorker.registerToken(tokenId, token);

    // ─── Block hidden quest enrollment while regular quest is running ───
    const workerState = QuestWorker.getState(tokenId);
    if (workerState && workerState.status === "running") {
      return NextResponse.json({
        success: false,
        error: "Đang làm quest — không thể nhận quest ẩn. Vui lòng dừng quest trước.",
      }, { status: 409 });
    }

    // 1. Assign proxy từ ProxyPool (1 token = 1 SID/quốc gia)
    const assignResult = await assignProxy(tokenId, countryCode);
    if (!assignResult.ok) {
      // Trả về lỗi cụ thể để frontend hiện đúng nút
      const reason = assignResult.reason; // "no_proxy" hoặc "full"
      return NextResponse.json({
        success: false,
        proxyError: reason,
        error: reason === "no_proxy"
          ? `Không thể tìm thấy proxy cho ${countryCode}`
          : `Quá nhiều người dùng ${countryCode}, quay lại sau`,
      }, { status: 502 });
    }

    const assignment = assignResult.assignment;
    const proxy = assignment.proxy;
    const proxyUri = `http://${encodeURIComponent(proxy.user)}:${encodeURIComponent(proxy.pass)}@${proxy.host}:${proxy.port}`;
    console.log(`[HiddenEnroll] ProxyPool → ${proxy.countryCode} ${proxy.host}:${proxy.port} | Token ${tokenId.slice(0, 12)} | Quest ${questId}`);

    const agent = new HttpsProxyAgent(proxyUri, { keepAlive: false });

    try {
    // 2. Warm-up: GET request qua proxy để thiết lập tunnel + kiểm tra ra được mạng
    let proxyOk = false;
    try {
      const warmupRes = await proxiedRequest("https://discord.com/api/v10/gateway", {
        method: "GET",
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000,
      }, agent);
      // Discord gateway endpoint luôn trả 200 với JSON { url: "wss://..." }
      // Nếu trả được status code hợp lệ → proxy đã ra được mạng
      proxyOk = warmupRes.statusCode > 0 && warmupRes.statusCode < 500;
      console.log(`[HiddenEnroll] Warm-up check: ${warmupRes.statusCode} → proxy ${proxyOk ? "OK" : "FAIL"}`);
    } catch (warmupErr) {
      console.log("[HiddenEnroll] Warm-up failed — proxy không kết nối được:",
        warmupErr instanceof Error ? warmupErr.message : String(warmupErr));
    }

    // Nếu proxy không ra được mạng → fallback trực tiếp
    if (!proxyOk) {
      console.log("[HiddenEnroll] Proxy không kết nối được, thử trực tiếp...");
      const { discordFetch } = await import("@/lib/discord");
      const body = JSON.stringify({
        location: isMobile ? 12 : 11,
        is_targeted: false,
        metadata_sealed: null,
        traffic_metadata_raw: (questData?.traffic_metadata_raw as string) || null,
        traffic_metadata_sealed: (questData?.traffic_metadata_sealed as string) || null,
      });

      const directRes = await discordFetch(token, `/quests/${questId}/enroll`, {
        method: "POST",
        body,
        headers: { AndroidRequest: isMobile ? "true" : "false" },
      }, tokenId);

      if (directRes.ok || directRes.status === 204) {
        let enrollData: unknown = null;
        try { enrollData = await directRes.json(); } catch {}
        return NextResponse.json({
          success: true,
          message: `Đã nhận quest (kết nối trực tiếp — proxy không khả dụng)`,
          proxyInfo: { country: proxy.countryCode || countryCode, ip: proxy.host, port: proxy.port },
          enrollData,
        });
      }

      const errText = await directRes.text().catch(() => "");
      const directError = parseDiscordError(directRes.status, errText);
      return NextResponse.json({
        success: false,
        discordCode: directError.code,
        error: directError.message,
      });
    }

    // 3. Build super-properties
    let superProps: string, userAgent: string, locale: string, timezone: string;
    if (tokenId && isGatewayReady(tokenId)) {
      superProps = getSuperProperties(tokenId);
      userAgent = getUserAgent(tokenId);
      locale = "en-US"; timezone = "Asia/Saigon";
    } else if (tokenId) {
      const built = await buildSuperProperties(tokenId);
      superProps = built.superProps; userAgent = built.fp.userAgent;
      locale = built.fp.locale; timezone = built.fp.timezone;
    } else {
      superProps = ""; userAgent = "Mozilla/5.0";
      locale = "en-US"; timezone = "Asia/Saigon";
    }

    // 4. Enroll qua proxy
    const body = JSON.stringify({
      location: isMobile ? 12 : 11,
      is_targeted: false,
      metadata_sealed: null,
      traffic_metadata_raw: (questData?.traffic_metadata_raw as string) || null,
      traffic_metadata_sealed: (questData?.traffic_metadata_sealed as string) || null,
    });

    console.log(`[HiddenEnroll] Enrolling via proxy...`);
    const res = await proxiedRequest(`${DISCORD_API}/quests/${questId}/enroll`, {
      method: "POST",
      headers: {
        "Authorization": token.replace(/^Bot\s+/i, ""),
        "Content-Type": "application/json",
        "User-Agent": userAgent,
        "x-super-properties": superProps,
        "x-debug-options": "bugReporterEnabled",
        "x-discord-locale": locale,
        "x-discord-timezone": timezone,
        "origin": "https://discord.com",
        "referer": "https://discord.com/channels/@me",
        "pragma": "no-cache",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "AndroidRequest": isMobile ? "true" : "false",
      },
      body,
      timeout: 30000,
    }, agent);

    console.log(`[HiddenEnroll] Response: ${res.statusCode} ${res.body.slice(0, 200)}`);

    if (res.statusCode >= 200 && res.statusCode < 300) {
      let enrollData: unknown = null;
      try { enrollData = JSON.parse(res.body); } catch {}
      return NextResponse.json({
        success: true,
        message: `Đã nhận quest qua proxy ${proxy.countryCode || countryCode}`,
        proxyInfo: { country: proxy.countryCode || countryCode, ip: proxy.host, port: proxy.port },
        enrollData,
      });
    }

    // Parse Discord error để trả về message có ý nghĩa
    const discordError = parseDiscordError(res.statusCode, res.body);
    console.log(`[HiddenEnroll] Discord error: ${discordError.code} — ${discordError.message}`);

    // Nếu lỗi do tài khoản không hợp lệ (401) — thử lại trực tiếp
    if (res.statusCode === 401) {
      console.log(`[HiddenEnroll] 401 qua proxy, thử lại trực tiếp...`);
      const { discordFetch } = await import("@/lib/discord");
      const directRes = await discordFetch(token, `/quests/${questId}/enroll`, {
        method: "POST",
        body,
        headers: { AndroidRequest: isMobile ? "true" : "false" },
      }, tokenId);

      if (directRes.ok || directRes.status === 204) {
        let enrollData: unknown = null;
        try { enrollData = await directRes.json(); } catch {}
        return NextResponse.json({
          success: true,
          message: `Đã nhận quest (kết nối trực tiếp)`,
          proxyInfo: { country: proxy.countryCode || countryCode, ip: proxy.host, port: proxy.port },
          enrollData,
        });
      }

      const directErrText = await directRes.text().catch(() => "");
      const directDiscordError = parseDiscordError(directRes.status, directErrText);
      return NextResponse.json({
        success: false,
        discordCode: directDiscordError.code,
        error: directDiscordError.message,
      });
    }

    // Các lỗi khác — trả về lỗi Discord đã parse
    return NextResponse.json({
      success: false,
      discordCode: discordError.code,
      error: discordError.message,
    });
    } finally {
      // Destroy HTTP agent (releases the TCP socket), but ProxyPool assignment stays
      // The pool assignment tracks the logical SID binding, not the TCP connection
      try { agent.destroy(); } catch {}
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[HiddenEnroll] Error:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

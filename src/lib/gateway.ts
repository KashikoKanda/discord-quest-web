// Discord Gateway WebSocket client for quest auto-completion
// Connects to Discord Gateway with proper Identify payload
// so that heartbeat/video-progress REST APIs work (they require active gateway session)
//
// Based on aiko-chan-ai/Discord-Quest-Auto-Completion-Selfbot approach:
// 1. Connect to Gateway WebSocket
// 2. Send Identify with full desktop client properties
// 3. Wait for READY event
// 4. Now REST calls to /heartbeat and /video-progress will work
// 5. Keep gateway alive with heartbeats while doing quests
//
// Gateway kết nối TRỰC TIẾP — không qua proxy
// Proxy chỉ dùng cho hidden-enroll (REST API), không dùng cho WebSocket

import WebSocket from "ws";
import { randomUUID } from "crypto";

const GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";

interface GatewayState {
  ws: WebSocket | null;
  heartbeatInterval: NodeJS.Timeout | null;
  seq: number | null;
  sessionId: string | null;
  ready: boolean;
  resumeUrl: string | null;
  // Fingerprint data - must match x-super-properties in REST calls
  fingerprint: {
    client_launch_id: string;
    launch_signature: string;
    client_heartbeat_session_id: string;
    client_build_number: number;
    client_version: string;
    browser_version: string;
    os_version: string;
    system_locale: string;
    timezone: string;
    user_agent: string;
  };
}

// Global map: tokenId → GatewayState
const gatewayStates = new Map<string, GatewayState>();

// Updated to match aiko-chan-ai latest constants
function createFingerprint(): GatewayState["fingerprint"] {
  const clientVersion = "1.0.9236";
  const buildNumber = 539951;
  const browserVersion = "37.6.0"; // Electron version (aiko uses this)
  const osVersion = "10.0.19045";

  return {
    client_launch_id: randomUUID(),
    launch_signature: randomUUID(),
    client_heartbeat_session_id: randomUUID(),
    client_build_number: buildNumber,
    client_version: clientVersion,
    browser_version: browserVersion,
    os_version: osVersion,
    system_locale: "en-US",
    timezone: "Asia/Saigon",
    user_agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/${clientVersion} Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36`,
  };
}

/**
 * Get or create gateway state for a token
 */
function getOrCreateState(tokenId: string): GatewayState {
  let state = gatewayStates.get(tokenId);
  if (!state) {
    state = {
      ws: null,
      heartbeatInterval: null,
      seq: null,
      sessionId: null,
      ready: false,
      resumeUrl: null,
      fingerprint: createFingerprint(),
    };
    gatewayStates.set(tokenId, state);
  }
  return state;
}

/**
 * Build the x-super-properties for REST calls
 * MUST match the Identify payload properties
 */
export function getSuperProperties(tokenId: string): string {
  const state = gatewayStates.get(tokenId);
  const fp = state?.fingerprint || createFingerprint();

  const props = {
    os: "Windows",
    browser: "Discord Client",
    release_channel: "stable",
    client_version: fp.client_version,
    os_version: fp.os_version,
    os_arch: "x64",
    app_arch: "x64",
    system_locale: fp.system_locale,
    has_client_mods: false,
    client_launch_id: fp.client_launch_id,
    browser_user_agent: fp.user_agent,
    browser_version: fp.browser_version,
    os_sdk_version: fp.os_version.split(".").pop() || "19045",
    client_build_number: fp.client_build_number,
    native_build_number: 81687, // Updated to match aiko latest
    client_event_source: null,
    launch_signature: fp.launch_signature,
    client_heartbeat_session_id: fp.client_heartbeat_session_id,
    client_app_state: "focused",
  };

  return Buffer.from(JSON.stringify(props)).toString("base64");
}

/**
 * Get the User-Agent for REST calls
 */
export function getUserAgent(tokenId: string): string {
  const state = gatewayStates.get(tokenId);
  return state?.fingerprint.user_agent || `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9236 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36`;
}

/**
 * Connect to Discord Gateway and wait for READY
 * Kết nối TRỰC TIẾP — không qua proxy
 *
 * @param tokenId - Token identifier
 * @param token - Discord token string
 * @returns true if connected successfully
 */
export async function connectGateway(
  tokenId: string,
  token: string
): Promise<boolean> {
  const state = getOrCreateState(tokenId);

  // If already connected and ready, return
  if (state.ready && state.ws?.readyState === WebSocket.OPEN) {
    return true;
  }

  return new Promise((resolve) => {
    try {
      const url = state.resumeUrl || GATEWAY_URL;
      const ws = new WebSocket(url, {
        headers: {
          "User-Agent": state.fingerprint.user_agent,
        },
      });

      state.ws = ws;
      let resolved = false;

      const done = (success: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve(success);
        }
      };

      ws.on("open", () => {
        console.log(`[Gateway:${tokenId.slice(0, 12)}] Connected`);
      });

      ws.on("message", (data: WebSocket.Data) => {
        try {
          const payload = JSON.parse(data.toString());
          handleGatewayMessage(tokenId, token, payload, state, done);
        } catch (err) {
          console.error(`[Gateway:${tokenId.slice(0, 12)}] Parse error:`, err);
        }
      });

      ws.on("close", (code, reason) => {
        console.log(`[Gateway:${tokenId.slice(0, 12)}] Closed: ${code} ${reason}`);
        state.ready = false;
        if (state.heartbeatInterval) {
          clearInterval(state.heartbeatInterval);
          state.heartbeatInterval = null;
        }
        // Auto-reconnect if not intentional
        if (code !== 1000 && code !== 4004) {
          setTimeout(() => connectGateway(tokenId, token), 5000);
        }
        done(false);
      });

      ws.on("error", (err) => {
        console.error(`[Gateway:${tokenId.slice(0, 12)}] Error:`, err.message);
        state.ready = false;
        done(false);
      });

      // Timeout after 15s if no READY
      setTimeout(() => {
        if (!state.ready) {
          console.warn(`[Gateway:${tokenId.slice(0, 12)}] Timeout waiting for READY`);
          done(false);
        }
      }, 15000);
    } catch (err) {
      console.error(`[Gateway:${tokenId.slice(0, 12)}] Connect error:`, err);
      resolve(false);
    }
  });
}

/**
 * Handle incoming gateway messages
 */
function handleGatewayMessage(
  tokenId: string,
  token: string,
  payload: { op: number; d: any; s?: number | null; t?: string },
  state: GatewayState,
  onReady: (success: boolean) => void
) {
  // Update sequence
  if (payload.s != null) {
    state.seq = payload.s;
  }

  switch (payload.op) {
    case 10: // HELLO
      // Start heartbeating
      const interval = payload.d.heartbeat_interval;
      if (state.heartbeatInterval) clearInterval(state.heartbeatInterval);
      state.heartbeatInterval = setInterval(() => {
        sendHeartbeat(tokenId, state);
      }, interval);
      // First heartbeat
      sendHeartbeat(tokenId, state);
      // Send Identify
      sendIdentify(tokenId, token, state);
      break;

    case 11: // HEARTBEAT_ACK
      // Server acknowledged heartbeat
      break;

    case 0: // DISPATCH
      if (payload.t === "READY") {
        state.sessionId = payload.d.session_id;
        state.resumeUrl = payload.d.resume_gateway_url;
        state.ready = true;
        console.log(`[Gateway:${tokenId.slice(0, 12)}] READY - session ${state.sessionId?.slice(0, 8)}`);
        onReady(true);
      } else if (payload.t === "RESUMED") {
        state.ready = true;
        console.log(`[Gateway:${tokenId.slice(0, 12)}] Resumed`);
      }
      break;

    case 7: // RECONNECT
      console.log(`[Gateway:${tokenId.slice(0, 12)}] Server requested reconnect`);
      state.ws?.close(4000);
      break;

    case 9: // INVALID_SESSION
      console.warn(`[Gateway:${tokenId.slice(0, 12)}] Invalid session, re-identifying`);
      state.sessionId = null;
      setTimeout(() => sendIdentify(tokenId, token, state), 3000);
      break;

    case 1: // HEARTBEAT request
      sendHeartbeat(tokenId, state);
      break;
  }
}

/**
 * Send heartbeat to gateway
 */
function sendHeartbeat(tokenId: string, state: GatewayState) {
  if (state.ws?.readyState !== WebSocket.OPEN) return;
  const payload = { op: 1, d: state.seq };
  state.ws.send(JSON.stringify(payload));
}

/**
 * Send Identify payload with full desktop client properties
 * This is the CRITICAL part - the properties must match x-super-properties in REST calls
 */
function sendIdentify(tokenId: string, token: string, state: GatewayState) {
  if (state.ws?.readyState !== WebSocket.OPEN) return;

  const fp = state.fingerprint;

  const identifyPayload = {
    op: 2, // Identify
    d: {
      token: token,
      properties: {
        os: "Windows",
        browser: "Discord Client",
        release_channel: "stable",
        client_version: fp.client_version,
        os_version: fp.os_version,
        os_arch: "x64",
        app_arch: "x64",
        system_locale: fp.system_locale,
        has_client_mods: false,
        client_launch_id: fp.client_launch_id,
        browser_user_agent: fp.user_agent,
        browser_version: fp.browser_version,
        os_sdk_version: fp.os_version.split(".").pop() || "19045",
        client_build_number: fp.client_build_number,
        native_build_number: 81687, // Updated to match aiko latest
        client_event_source: null,
        launch_signature: fp.launch_signature,
        client_heartbeat_session_id: fp.client_heartbeat_session_id,
        client_app_state: "focused",
        is_fast_connect: false,
        gateway_connect_reasons: "AppSkeleton",
      },
      capabilities: 0,
      presence: { status: "online", since: 0, activities: [], afk: false },
      compress: false,
      client_state: { guild_versions: {} },
    },
  };

  console.log(`[Gateway:${tokenId.slice(0, 12)}] Sending Identify...`);
  state.ws.send(JSON.stringify(identifyPayload));
}

/**
 * Disconnect gateway for a token
 */
export function disconnectGateway(tokenId: string) {
  const state = gatewayStates.get(tokenId);
  if (!state) return;

  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
    state.heartbeatInterval = null;
  }

  if (state.ws) {
    state.ws.close(1000);
    state.ws = null;
  }

  state.ready = false;
  state.sessionId = null;
  gatewayStates.delete(tokenId);
}

/**
 * Check if gateway is connected and ready
 */
export function isGatewayReady(tokenId: string): boolean {
  const state = gatewayStates.get(tokenId);
  return state?.ready === true && state.ws?.readyState === WebSocket.OPEN;
}

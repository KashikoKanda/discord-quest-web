/**
 * CapSolver — giải hCaptcha enterprise của Discord ở phía server.
 *
 * Vì sao cần: token hCaptcha gắn với domain nơi nó được giải. Người dùng giải
 * trên discord-quests.onrender.com thì Discord coi như không có (trả lại
 * captcha-required). CapSolver giải bằng hạ tầng của họ với websiteURL
 * https://discord.com và gửi kèm rqdata/rqtoken của thử thách, nên token đúng
 * chuẩn mà Discord chấp nhận.
 *
 * Bật bằng cách đặt biến môi trường CAPSOLVER_API_KEY (trên Render:
 * Environment → Add Environment Variable).
 */

const CAPSOLVER_CREATE = "https://api.capsolver.com/createTask";
const CAPSOLVER_RESULT = "https://api.capsolver.com/getTaskResult";

export interface CaptchaChallenge {
  sitekey: string;
  rqdata?: string;
  rqtoken?: string;
}

export function capsolverEnabled(): boolean {
  return Boolean(process.env.CAPSOLVER_API_KEY && process.env.CAPSOLVER_API_KEY.trim());
}

/**
 * Solve Discord's hCaptcha through CapSolver.
 * Returns the solved token, or null when the solver isn't configured.
 * Throws on solver errors so the caller can fall back to the manual widget.
 */
export async function solveDiscordCaptcha(challenge: CaptchaChallenge): Promise<string | null> {
  const clientKey = process.env.CAPSOLVER_API_KEY?.trim();
  if (!clientKey) return null;
  if (!challenge.sitekey) throw new Error("CapSolver: thiếu sitekey");

  const createRes = await fetch(CAPSOLVER_CREATE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey,
      task: {
        type: "HCaptchaTaskProxyLess",
        websiteURL: "https://discord.com",
        websiteKey: challenge.sitekey,
        // rqdata/rqtoken khoá token vào đúng thử thách Discord vừa phát ra.
        enterprisePayload: {
          rqdata: challenge.rqdata,
          rqtoken: challenge.rqtoken,
        },
      },
    }),
  });

  const created = (await createRes.json().catch(() => ({}))) as {
    errorId?: number;
    errorCode?: string;
    errorDescription?: string;
    taskId?: string;
  };
  if (created.errorId || !created.taskId) {
    throw new Error(
      `CapSolver createTask lỗi: ${created.errorCode || created.errorDescription || "unknown"}`,
    );
  }

  const taskId = created.taskId;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3_000));
    const pollRes = await fetch(CAPSOLVER_RESULT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientKey, taskId }),
    });
    const polled = (await pollRes.json().catch(() => ({}))) as {
      errorId?: number;
      errorCode?: string;
      errorDescription?: string;
      status?: string;
      solution?: { gRecaptchaResponse?: string; token?: string };
    };
    if (polled.errorId) {
      throw new Error(
        `CapSolver getTaskResult lỗi: ${polled.errorCode || polled.errorDescription || "unknown"}`,
      );
    }
    if (polled.status === "ready") {
      const token = polled.solution?.gRecaptchaResponse || polled.solution?.token;
      if (!token) throw new Error("CapSolver: solution rỗng");
      return token;
    }
  }
  throw new Error("CapSolver: hết thời gian chờ giải captcha (120s)");
}

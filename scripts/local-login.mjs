#!/usr/bin/env node
/**
 * Đăng nhập Discord bằng EMAIL + MẬT KHẨU, chạy NGAY TRÊN MÁY BẠN.
 *
 * Vì sao phải chạy ở máy: Discord chặn login email từ origin của web
 * (trả 50067 "Invalid request origin") và trình duyệt không cho sửa Origin.
 * Chạy trên máy bạn thì request đi từ đúng IP nhà, không qua server, không qua
 * proxy — giống hệt cách login bằng token, chỉ khác là token được sinh ra tại
 * máy thay vì dán tay.
 *
 * Cách dùng:
 *   node scripts/local-login.mjs
 *   (hoặc: npx --yes node scripts/local-login.mjs)
 *
 * Kết quả: in ra một khối JSON y như lệnh Copy ở trang login. Dán nguyên khối
 * đó vào ô Token của web. Token không được gửi đi đâu ngoài discord.com.
 */
import readline from "node:readline";
import process from "node:process";

const API = "https://discord.com/api/v9";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/138.0.0.0 Safari/537.36";

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const onData = (char) => {
      if (["\n", "\r", "\u0004"].includes(char.toString())) {
        process.stdin.removeListener("data", onData);
      } else {
        process.stdout.write("*");
      }
    };
    process.stdout.write(question);
    process.stdin.on("data", onData);
    rl.question("", (a) => { rl.close(); process.stdout.write("\n"); resolve(a.trim()); });
  });
}

const baseHeaders = {
  "Content-Type": "application/json",
  "User-Agent": UA,
  "Accept": "*/*",
  "Accept-Language": "vi,en;q=0.9",
  "Origin": "https://discord.com",
  "Referer": "https://discord.com/login",
};

async function post(path, body) {
  const r = await fetch(API + path, { method: "POST", headers: baseHeaders, body: JSON.stringify(body) });
  let json = null;
  try { json = await r.json(); } catch { /* body rỗng */ }
  return { status: r.status, json };
}

async function main() {
  console.log("\nĐăng nhập Discord tại máy (IP nhà, không qua server/proxy)");
  console.log("Token chỉ gửi tới discord.com. Không chia sẻ token cho ai.\n");

  const login = await ask("Email hoặc số điện thoại: ");
  const password = await askHidden("Mật khẩu: ");

  let body = {
    login,
    password,
    undelete: false,
    captcha_key: null,
    login_source: null,
    gift_code_sku_id: null,
  };

  let res = await post("/auth/login", body);

  // Discord đòi captcha: in sitekey, xin token hCaptcha đã giải
  if (res.json && res.json.captcha_sitekey) {
    console.log("\nDiscord yêu cầu captcha.");
    console.log("  sitekey:", res.json.captcha_sitekey, "| service:", res.json.captcha_service || "hcaptcha");
    console.log("  Cách qua: mở https://discord.com/login trên trình duyệt, đăng nhập tới bước captcha,");
    console.log("  F12 → Network → request 'login' → copy giá trị captcha_key trong payload, dán vào đây.");
    const captchaKey = await ask("captcha_key: ");
    body = {
      ...body,
      captcha_key: captchaKey,
      captcha_rqtoken: res.json.captcha_rqtoken || null,
      captcha_session_id: res.json.captcha_session_id || null,
    };
    res = await post("/auth/login", body);
  }

  // 2FA
  if (res.json && (res.json.mfa === true || res.json.ticket)) {
    const ticket = res.json.ticket;
    console.log("\nTài khoản bật 2FA.");
    const code = await ask("Mã 2FA (6 số) hoặc mã dự phòng: ");
    const mfa = await post("/auth/mfa", {
      ticket,
      mfa_code: code,
      login: body.login,
      password: body.password,
    });
    if (mfa.json && mfa.json.token) res = { status: 200, json: mfa.json };
    else res = mfa;
  }

  const token = res.json && (res.json.token || res.json.access_token);
  if (!token) {
    console.error("\nKhông lấy được token.");
    console.error("  HTTP", res.status, "|", JSON.stringify(res.json).slice(0, 300));
    if (res.status === 400 && res.json?.message) console.error("  Gợi ý: kiểm tra lại email/mật khẩu.");
    process.exit(1);
  }

  // Xác thực token và in khối JSON để dán vào web
  const me = await fetch(API + "/users/@me", {
    headers: { ...baseHeaders, Authorization: token },
  });
  const profile = me.ok ? await me.json() : null;

  const payload = {
    t: token,
    ua: UA,
    al: "vi",
    als: "vi,en",
    p: "Win32",
    hc: 8,
    dm: 8,
    scr: "1920x1080x24",
    dpr: 1,
    tzo: -420,
    l: "vi",
    tz: "Asia/Saigon",
    sp: "",
    fp: "",
    ii: "",
    dbg: "",
    cv: "",
  };

  console.log("\n=== Dán nguyên khối dưới đây vào ô Token của web ===");
  console.log(JSON.stringify(payload));
  console.log("=== hết ===");
  if (profile) console.log(`\nTài khoản: ${profile.username} (${profile.id})`);
  console.log("Token này sinh ra tại máy bạn nên dùng tiếp trong trình duyệt là cùng một IP.");
}

main().catch((e) => {
  console.error("Lỗi:", e?.message || e);
  process.exit(1);
});

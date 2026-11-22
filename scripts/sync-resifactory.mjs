#!/usr/bin/env node
/**
 * Kéo proxy ResiFactory (sticky residential) và in ra PROXY_LIST_B64 cho DQA.
 *
 *   RF_API_TOKEN=rf_live_... node scripts/sync-resifactory.mjs --country vn --count 2
 *
 * Cờ:
 *   --country vn        mã ISO-2, mặc định vn
 *   --count 2           số dòng proxy (1 IP phục vụ tối đa 2 token)
 *   --minutes 1440      thời gian giữ nguyên IP (Premium tối đa 1440, Essential 120)
 *   --pool retail_select | walmart_premium   (mặc định walmart_premium)
 *   --test              gọi /api/proxy-list/test để kiểm tra sống/chết ngay
 *   --write-env         in luôn giá trị base64 để dán vào PROXY_LIST_B64
 *
 * Không in mật khẩu ra stdout khi chỉ kiểm tra; dùng --show để xem đầy đủ.
 */
const API = "https://resifactory.net/api/v1";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? def : (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true);
};
const flag = (name) => argv.includes(`--${name}`);

const token = process.env.RF_API_TOKEN || process.env.TOOLIP_API_TOKEN;
if (!token) {
  console.error("Thiếu RF_API_TOKEN (hoặc TOOLIP_API_TOKEN) trong env.");
  process.exit(1);
}
const country = String(arg("country", "vn")).toLowerCase();
const count = Number(arg("count", 2));
const minutes = Number(arg("minutes", 1440));
const pool = String(arg("pool", "walmart_premium"));

const res = await fetch(`${API}/proxies`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "User-Agent": UA },
  body: JSON.stringify({ pool, country, proxyType: "sticky", sessionDuration: minutes, quantity: count, protocol: "http", format: "list" }),
});
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`ResiFactory ${res.status}:`, JSON.stringify(data).slice(0, 300));
  process.exit(1);
}
if (data.is_demo) {
  console.error("⚠ Ví đang 0 GB nên ResiFactory trả bản DEMO (mật khẩu INVALID). Nạp tối thiểu $0.50 rồi chạy lại.");
  process.exit(2);
}

const lines = String(data.proxies || "").trim().split("\n").filter(Boolean);
console.log(`# pool=${data.pool} country=${data.country} sticky=${data.session_duration}m lines=${lines.length}`);
lines.forEach((l, i) => {
  const [h, p, u] = l.split(":");
  console.log(`#${i + 1} ${h}:${p} user=${u}${flag("show") ? ` pass=${l.split(":")[3]}` : " pass=***"}`);
});

const b64 = Buffer.from(lines.join("\n")).toString("base64");
if (flag("write-env") || flag("show")) console.log(`\nPROXY_LIST_B64=${b64}`);

if (flag("test")) {
  const base = process.env.DQA_BASE || "https://discord-quests.onrender.com";
  const url = `${base}/api/proxy-list/test?list=${encodeURIComponent(b64)}`;
  const r = await fetch(url);
  const out = await r.json().catch(() => ({}));
  console.log("\nTest:", JSON.stringify(out.summary || out));
  for (const item of (out.results || []).slice(0, 10)) {
    console.log(` ${item.ok ? "OK " : "dead"} ${item.proxy} ${item.ms ?? "-"}ms ${item.error ? String(item.error).slice(0, 70) : ""}`);
  }
}

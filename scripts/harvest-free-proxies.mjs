#!/usr/bin/env node
/**
 * Thu proxy free từ các nguồn công khai rồi THỬ THẬT qua discord.com.
 *
 *   node scripts/harvest-free-proxies.mjs            # chỉ in kết quả
 *   node scripts/harvest-free-proxies.mjs --b64      # in base64 để dán vào PROXY_LIST_B64
 *   node scripts/harvest-free-proxies.mjs --out ok.txt
 *
 * LƯU Ý: phải chạy ở máy/Render (mở được cổng 80/8080/3128). Sandbox Base44 chỉ
 * ra được cổng 443 nên không test proxy được.
 *
 * CẢNH BÁO: proxy free là IP dùng chung, phần lớn là datacenter, đã bị cộng đồng
 * lạm dụng. Dùng cho login/quest Discord thì rủi ro revoke token rất cao — chỉ
 * nên coi là chỗ chữa cháy, không thay proxy trả phí.
 */
import { ProxyAgent, fetch as undiciFetch } from "undici";

const SOURCES = [
  { name: "proxyscrape", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=yes&anonymity=all" },
  { name: "monosans", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt" },
  { name: "speedx", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt" },
];

const OK_PORTS = new Set(["80", "8080", "3128", "8000", "8888", "8118", "1080", "4145", "9090", "10809"]);
const CONCURRENCY = 25;
const TIMEOUT_MS = 9000;

async function collect() {
  const seen = new Set();
  const out = [];
  for (const src of SOURCES) {
    try {
      const res = await fetch(src.url, { signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      let added = 0;
      for (const raw of text.split(/\s+/)) {
        const m = raw.match(/^([\w.-]+):(\d{2,5})$/);
        if (!m) continue;
        const [, host, port] = m;
        if (!OK_PORTS.has(port)) continue;
        const key = `${host}:${port}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ host, port: Number(port), source: src.name });
        added++;
      }
      console.log(`[harvest] ${src.name}: +${added} (tổng ${out.length})`);
    } catch (err) {
      console.log(`[harvest] ${src.name}: lỗi ${err.message}`);
    }
  }
  return out;
}

async function probe(proxy) {
  const agent = new ProxyAgent({ uri: `http://${proxy.host}:${proxy.port}`, requestTls: { rejectUnauthorized: false } });
  const started = Date.now();
  try {
    const res = await undiciFetch("https://discord.com/api/v9/gateway", {
      dispatcher: agent,
      headers: { "User-Agent": "DiscordBot (https://discord.com, 1.0)" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.text().catch(() => "");
    return { ...proxy, ok: res.ok, status: res.status, ms: Date.now() - started, note: res.ok ? "" : body.slice(0, 80) };
  } catch (err) {
    const cause = err?.cause?.code || err?.cause?.message || "";
    return { ...proxy, ok: false, status: null, ms: Date.now() - started, note: `${err.message} ${cause}`.trim() };
  } finally {
    await agent.close().catch(() => {});
  }
}

async function pool(items, worker, size) {
  const results = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await worker(items[idx]);
      }
    }),
  );
  return results;
}

const args = process.argv.slice(2);
const wantB64 = args.includes("--b64");
const outIdx = args.indexOf("--out");
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

const candidates = await collect();
console.log(`[harvest] thử ${candidates.length} proxy qua discord.com ...`);
const results = await pool(candidates, probe, CONCURRENCY);
const working = results.filter((r) => r.ok).sort((a, b) => a.ms - b.ms);

console.log(`\n[harvest] SỐNG ${working.length}/${results.length}`);
for (const r of working) console.log(`  ${r.host}:${r.port}  ${r.ms}ms  (${r.source})`);

if (working.length > 0) {
  const lines = working.map((r) => `http://${r.host}:${r.port}`).join("\n");
  if (outFile) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outFile, lines + "\n");
    console.log(`\n[harvest] đã ghi ${working.length} proxy vào ${outFile}`);
  }
  if (wantB64) {
    console.log("\n=== PROXY_LIST_B64 ===\n" + Buffer.from(lines).toString("base64") + "\n");
  }
}

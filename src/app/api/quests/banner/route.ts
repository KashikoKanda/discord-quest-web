import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";

/**
 * Banner quest: cache 3 tầng, dùng chung cho MỌI token.
 *
 * Key chỉ là questId + hero asset, không có token, nên 20 account cùng một
 * quest chỉ tải ảnh từ Discord CDN đúng MỘT lần. Trước đây chỉ có cache đĩa
 * trong process.cwd()/db — thư mục đó bị xoá mỗi lần deploy và có thể không
 * ghi được, thành ra mỗi lần mở dashboard là mỗi banner MISS, ảnh nhấp nháy
 * load lại.
 *
 * Thứ tự phục vụ: RAM (Map) → đĩa (/tmp) → Discord CDN.
 * Request trùng nhau đang bay thì dùng chung một promise, không gọi CDN 2 lần.
 */

const CACHE_DIR = process.env.BANNER_CACHE_DIR || join(tmpdir(), "dqa-banners");
const MAX_AGE = 604800; // 7 ngày cho browser
const S_MAX_AGE = 2592000; // 30 ngày cho CDN/proxy
const STALE_AFTER = 14 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000;

const MAX_MEM_ENTRIES = 400;
const MAX_MEM_BYTES = 96 * 1024 * 1024; // 96 MB

type Entry = { buf: Buffer; etag: string; at: number };
const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<{ buf: Buffer; etag: string; from: "CDN" | "DISK" }>>();
let memBytes = 0;

try {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
} catch {
  /* thư mục không ghi được thì chỉ dùng RAM */
}

let lastCleanup = 0;

function keyOf(questId: string, heroAsset: string): string {
  return `${questId}_${heroAsset}`;
}

function safeFilename(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "_") + ".webp";
}

function etagOf(buf: Buffer): string {
  return createHash("md5").update(buf).digest("hex").slice(0, 20);
}

function memGet(key: string): Entry | undefined {
  const hit = mem.get(key);
  if (!hit) return undefined;
  // refresh LRU order
  mem.delete(key);
  mem.set(key, hit);
  return hit;
}

function memPut(key: string, entry: Entry) {
  const prev = mem.get(key);
  if (prev) memBytes -= prev.buf.length;
  mem.set(key, entry);
  memBytes += entry.buf.length;
  while (mem.size > MAX_MEM_ENTRIES || memBytes > MAX_MEM_BYTES) {
    const oldest = mem.keys().next().value as string | undefined;
    if (!oldest) break;
    const gone = mem.get(oldest);
    if (gone) memBytes -= gone.buf.length;
    mem.delete(oldest);
  }
}

function cleanupStaleBanners() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  try {
    let deleted = 0;
    for (const file of readdirSync(CACHE_DIR)) {
      const p = join(CACHE_DIR, file);
      try {
        if (now - statSync(p).mtimeMs > STALE_AFTER) {
          unlinkSync(p);
          deleted++;
        }
      } catch {}
    }
    if (deleted > 0) console.log(`[BannerCache] Dọn ${deleted} banner cũ (>14 ngày)`);
  } catch {}
}

function headers(etag: string, cache: string): Record<string, string> {
  return {
    "Content-Type": "image/webp",
    "Cache-Control": `public, max-age=${MAX_AGE}, s-maxage=${S_MAX_AGE}, immutable, stale-while-revalidate=86400`,
    "ETag": etag,
    "X-Cache": cache,
  };
}

async function loadFromCdn(
  key: string,
  cdnUrl: string,
): Promise<{ buf: Buffer; etag: string; from: "CDN" | "DISK" }> {
  const running = inflight.get(key);
  if (running) return running;

  const job = (async () => {
    const cacheFile = join(CACHE_DIR, safeFilename(key));

    // tầng đĩa
    try {
      if (existsSync(cacheFile)) {
        const buf = readFileSync(cacheFile);
        if (buf.length > 0) return { buf, etag: etagOf(buf), from: "DISK" as const };
      }
    } catch {}

    const res = await fetch(cdnUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      cache: "force-cache",
    });
    if (!res.ok) {
      if (res.status === 404) {
        try { if (existsSync(cacheFile)) unlinkSync(cacheFile); } catch {}
      }
      throw Object.assign(new Error(`cdn ${res.status}`), { status: res.status });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    try { writeFileSync(cacheFile, buf); } catch {}
    return { buf, etag: etagOf(buf), from: "CDN" as const };
  })();

  inflight.set(key, job);
  try {
    return await job;
  } finally {
    inflight.delete(key);
  }
}

export async function GET(req: NextRequest) {
  const questId = req.nextUrl.searchParams.get("questId");
  const heroAsset = req.nextUrl.searchParams.get("hero");
  if (!questId || !heroAsset) return new NextResponse("Missing params", { status: 400 });

  cleanupStaleBanners();

  const key = keyOf(questId, heroAsset);
  const cdnUrl = heroAsset.includes("/")
    ? `https://cdn.discordapp.com/${heroAsset}`
    : `https://cdn.discordapp.com/quests/${questId}/assets/${heroAsset}.webp`;

  const ifNoneMatch = req.headers.get("if-none-match");

  // tầng RAM
  const hit = memGet(key);
  if (hit) {
    if (ifNoneMatch && ifNoneMatch.replace(/^W\//, "") === hit.etag) {
      return new NextResponse(null, { status: 304, headers: headers(hit.etag, "RAM-304") });
    }
    return new NextResponse(hit.buf as unknown as BodyInit, { headers: headers(hit.etag, "RAM") });
  }

  try {
    const { buf, etag, from } = await loadFromCdn(key, cdnUrl);
    memPut(key, { buf, etag, at: Date.now() });
    if (ifNoneMatch && ifNoneMatch.replace(/^W\//, "") === etag) {
      return new NextResponse(null, { status: 304, headers: headers(etag, `${from}-304`) });
    }
    return new NextResponse(buf as unknown as BodyInit, { headers: headers(etag, from) });
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return new NextResponse("Not found", { status: 404 });
    return new NextResponse("Fetch error", { status: 502 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const CACHE_DIR = join(process.cwd(), "db", "banners");
const MAX_AGE = 604800; // 7 days cache (was 24h)
const STALE_AFTER = 14 * 24 * 60 * 60 * 1000; // 14 days — files older than this get deleted
const CLEANUP_INTERVAL = 6 * 60 * 60 * 1000; // Run cleanup every 6 hours

// Ensure cache dir exists
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

// Track last cleanup time
let lastCleanup = 0;

function safeFilename(questId: string, heroAsset: string): string {
  const safe = `${questId}_${heroAsset}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  return safe + ".webp";
}

/**
 * Generate ETag from file stats (size + mtime) for 304 responses
 */
function generateETag(size: number, mtimeMs: number): string {
  return createHash("md5").update(`${size}-${mtimeMs}`).digest("hex").slice(0, 16);
}

/**
 * Cleanup stale banner files older than STALE_AFTER
 * Runs at most every CLEANUP_INTERVAL
 */
function cleanupStaleBanners() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  try {
    const files = readdirSync(CACHE_DIR);
    let deleted = 0;
    for (const file of files) {
      const filePath = join(CACHE_DIR, file);
      try {
        const stats = statSync(filePath);
        if (now - stats.mtimeMs > STALE_AFTER) {
          unlinkSync(filePath);
          deleted++;
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }
    if (deleted > 0) {
      console.log(`[BannerCache] Cleaned up ${deleted} stale banner files (older than 14 days)`);
    }
  } catch (err) {
    console.error("[BannerCache] Cleanup error:", err instanceof Error ? err.message : String(err));
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const questId = url.searchParams.get("questId");
  const heroAsset = url.searchParams.get("hero");

  if (!questId || !heroAsset) {
    return new NextResponse("Missing params", { status: 400 });
  }

  // Run cleanup (no-op if recently cleaned)
  cleanupStaleBanners();

  // Build Discord CDN URL
  let cdnUrl: string;
  if (heroAsset.includes("/")) {
    cdnUrl = `https://cdn.discordapp.com/${heroAsset}`;
  } else {
    cdnUrl = `https://cdn.discordapp.com/quests/${questId}/assets/${heroAsset}.webp`;
  }

  // Check disk cache
  const cacheFile = join(CACHE_DIR, safeFilename(questId, heroAsset));
  if (existsSync(cacheFile)) {
    const data = readFileSync(cacheFile);
    const stats = statSync(cacheFile);
    const etag = generateETag(stats.size, stats.mtimeMs);

    // Check If-None-Match → return 304 (browser uses cached version, no data transfer)
    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          "ETag": etag,
          "Cache-Control": `public, max-age=${MAX_AGE}, immutable`,
          "X-Cache": "HIT-304",
        },
      });
    }

    return new NextResponse(data, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": `public, max-age=${MAX_AGE}, immutable`,
        "ETag": etag,
        "X-Cache": "HIT",
      },
    });
  }

  // Fetch from Discord CDN
  try {
    const res = await fetch(cdnUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!res.ok) {
      // If 404 → quest/banner no longer exists → clean up any stale cache for it
      if (res.status === 404) {
        try {
          if (existsSync(cacheFile)) unlinkSync(cacheFile);
        } catch {}
      }
      return new NextResponse("Fetch failed", { status: res.status });
    }

    const buffer = Buffer.from(await res.arrayBuffer());

    // Save to disk cache (non-blocking)
    try {
      writeFileSync(cacheFile, buffer);
    } catch {
      // Cache write failure is non-critical
    }

    const etag = generateETag(buffer.length, Date.now());

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": `public, max-age=${MAX_AGE}, immutable`,
        "ETag": etag,
        "X-Cache": "MISS",
      },
    });
  } catch {
    return new NextResponse("Fetch error", { status: 502 });
  }
}

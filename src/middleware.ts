/**
 * Edge middleware — lớp bảo vệ network cho toàn bộ app.
 *
 * Mục tiêu:
 *   1. Rate limit theo IP: chặn brute-force /login, spam /api/quests, và crawler
 *      quét endpoint. Không có giới hạn thì bất kỳ ai cũng gọi API liên tục và
 *      "trộm" được dữ liệu trả về (quest, profile, proxy list) hoặc đốt CPU.
 *   2. Chặn CSRF: mọi request thay đổi dữ liệu (POST/PUT/PATCH/DELETE) vào /api/*
 *      phải đến từ chính domain này. Trình duyệt luôn gửi Origin, nên site khác
 *      không thể mượn phiên của người dùng. Request không có Origin (curl,
 *      keep-alive nội bộ) vẫn cho qua nhưng chịu rate limit.
 *   3. Chặn sớm các đường quét phổ biến (.env, .git, wp-admin...) trước khi chúng
 *      chạm tới route/DB.
 *   4. Header bảo mật + no-store cho API để proxy/CDN không cache dữ liệu riêng tư.
 */

import { NextRequest, NextResponse } from "next/server";

const WINDOW_MS = 60_000;

/** Giới hạn theo tiền tố đường dẫn — chặt nhất ở auth, rộng nhất ở API thường. */
const RATE_LIMITS: Array<{ prefix: string; max: number }> = [
  { prefix: "/api/auth", max: 30 },
  { prefix: "/api/quests", max: 120 },
  { prefix: "/api", max: 180 },
];

const BLOCKED_PATHS = [
  "/.env",
  "/.git",
  "/wp-admin",
  "/wp-login",
  "/wp-content",
  "/phpmyadmin",
  "/xmlrpc.php",
  "/vendor/phpunit",
  "/actuator",
  "/.aws",
  "/config.json",
];

type Bucket = { count: number; reset: number };
const globalForLimiter = globalThis as unknown as { __rateBuckets?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  if (!globalForLimiter.__rateBuckets) {
    globalForLimiter.__rateBuckets = new Map();
    // Dọn bucket hết hạn mỗi phút để Map không phình vô hạn.
    setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of globalForLimiter.__rateBuckets!) {
        if (bucket.reset <= now) globalForLimiter.__rateBuckets!.delete(key);
      }
    }, WINDOW_MS).unref?.();
  }
  return globalForLimiter.__rateBuckets;
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

function limitFor(pathname: string): number | null {
  for (const rule of RATE_LIMITS) {
    if (pathname.startsWith(rule.prefix)) return rule.max;
  }
  return null;
}

function securityHeaders(res: NextResponse, isApi: boolean): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (isApi) {
    // Dữ liệu quest/token là riêng tư: không cho CDN hay proxy cache lại.
    res.headers.set("Cache-Control", "no-store, max-age=0");
  }
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api");

  // 3) Quét path nhạy cảm → trả 404 luôn, không để lộ app dùng Next.js.
  if (BLOCKED_PATHS.some((p) => pathname.toLowerCase().startsWith(p))) {
    return new NextResponse("Not Found", { status: 404 });
  }

  if (isApi) {
    // 2) CSRF: request thay đổi dữ liệu phải cùng origin với site này.
    const method = req.method.toUpperCase();
    const mutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
    if (mutating) {
      const origin = req.headers.get("origin");
      if (origin) {
        let originHost = "";
        try {
          originHost = new URL(origin).host;
        } catch {
          originHost = "";
        }
        const allowedHosts = new Set(
          [req.nextUrl.host, req.headers.get("host"), process.env.BASE_URL ? new URL(process.env.BASE_URL).host : ""]
            .filter(Boolean)
            .map((h) => h as string),
        );
        if (!originHost || !allowedHosts.has(originHost)) {
          return securityHeaders(
            NextResponse.json({ success: false, error: "Cross-site request blocked" }, { status: 403 }),
            true,
          );
        }
      }
    }

    // 1) Rate limit theo IP + route prefix.
    const max = limitFor(pathname);
    if (max !== null) {
      const key = `${clientIp(req)}:${pathname.split("/").slice(0, 3).join("/")}`;
      const now = Date.now();
      const store = buckets();
      const bucket = store.get(key);
      if (!bucket || bucket.reset <= now) {
        store.set(key, { count: 1, reset: now + WINDOW_MS });
      } else {
        bucket.count += 1;
        if (bucket.count > max) {
          const retryAfter = Math.max(1, Math.ceil((bucket.reset - now) / 1000));
          const res = NextResponse.json(
            { success: false, error: "Quá nhiều request, thử lại sau." },
            { status: 429 },
          );
          res.headers.set("Retry-After", String(retryAfter));
          return securityHeaders(res, true);
        }
      }
    }
  }

  return securityHeaders(NextResponse.next(), isApi);
}

export const config = {
  // Bỏ qua asset tĩnh để middleware không tốn CPU cho mỗi file JS/CSS.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

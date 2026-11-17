"use client";

import { memo } from "react";
import { useIsMobile } from "@/lib/useIsMobile";

/**
 * AuroraBackground — CSS-only aurora gradient mesh (Aurora redesign).
 *
 * Replaces the previous framer-motion 5-orb version which was laggy on
 * mobile. The new design uses 3 CSS-only blobs driven by `.aurora-blob-1/2/3`
 * keyframe animations (transform-only — no filter:blur, no mix-blend-mode,
 * no JS animation loop). Backgrounds use `radial-gradient(circle, ...)` so
 * the gradient itself softens the edge — no blur filter needed.
 *
 * Mobile: renders ONLY 2 blobs (smaller sizes), no grid/starfield. The
 * `.aurora-blob-*` animations are disabled by the mobile media query in
 * globals.css (saves battery + avoids scroll reflow on iOS).
 *
 * Accessibility: the global `@media (prefers-reduced-motion: reduce)` block
 * in globals.css kills the `.aurora-blob-*` animation-duration, so users
 * with the OS preference set see static blobs (still beautiful, no motion).
 * No JS animation loops to gate — this component is 100% declarative.
 *
 * Public API kept identical to the previous version so existing callers
 * (LoginPage, Dashboard, Settings, HiddenQuests, VoiceHanger, Proxy,
 * page.tsx LoadingSplash) continue to work without changes:
 *   <AuroraBackground intensity="vibrant" showStarfield />
 */
function AuroraBackgroundImpl({
  className = "",
  showGrid = false,
  showStarfield = false,
  intensity = "normal",
}: {
  className?: string;
  showGrid?: boolean;
  showStarfield?: boolean;
  intensity?: "subtle" | "normal" | "vibrant";
}) {
  const isMobile = useIsMobile();

  // Intensity controls opacity multipliers — subtler overall now.
  const op = intensity === "subtle" ? 0.6 : intensity === "vibrant" ? 1.0 : 0.8;

  // ─── Mobile: 2 small static blobs, no grid/starfield, no animation ───
  // The mobile media query in globals.css disables `.aurora-blob-*`
  // animations so even if we apply the class, nothing animates on mobile.
  if (isMobile) {
    return (
      <div
        className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
        style={{ background: "#0A0B0E", zIndex: 0 }}
        aria-hidden
      >
        <div
          className="absolute top-[-15%] left-[-12%] w-[55vw] h-[55vw] rounded-full aurora-blob-1 gpu-layer"
          style={{
            background: `radial-gradient(circle, rgba(94, 106, 210, ${0.22 * op}) 0%, rgba(94, 106, 210, ${0.06 * op}) 35%, transparent 65%)`,
          }}
        />
        <div
          className="absolute bottom-[-18%] right-[-12%] w-[50vw] h-[50vw] rounded-full aurora-blob-2 gpu-layer"
          style={{
            background: `radial-gradient(circle, rgba(232, 121, 249, ${0.16 * op}) 0%, rgba(232, 121, 249, ${0.04 * op}) 35%, transparent 65%)`,
          }}
        />
        {/* Soft vignette so the blobs don't bleed into text on small screens */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 90% 70% at 50% 50%, transparent 35%, rgba(10, 11, 14, 0.6) 80%, rgba(10, 11, 14, 0.9) 100%)",
          }}
        />
      </div>
    );
  }

  // ─── Desktop: 3 CSS-only animated blobs (indigo / fuchsia / emerald) ───
  return (
    <div
      className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}
      style={{ background: "#0A0B0E", zIndex: 0 }}
      aria-hidden
    >
      {/* Subtle starfield overlay (cosmic dot pattern, opacity 0.04) */}
      {showStarfield && <div className="absolute inset-0 starfield" />}

      {/* Subtle grid overlay (very faint, 64px squares, opacity 0.015) */}
      {showGrid && <div className="grid-overlay" />}

      {/* Blob 1 — indigo, top-left, 60vw, 28s drift */}
      <div
        className="absolute top-[-15%] left-[-10%] w-[60vw] h-[60vw] rounded-full aurora-blob-1 gpu-layer"
        style={{
          background: `radial-gradient(circle, rgba(94, 106, 210, ${0.4 * op}) 0%, rgba(94, 106, 210, ${0.1 * op}) 35%, transparent 65%)`,
        }}
      />

      {/* Blob 2 — fuchsia, bottom-right, 55vw, 32s drift */}
      <div
        className="absolute bottom-[-20%] right-[-10%] w-[55vw] h-[55vw] rounded-full aurora-blob-2 gpu-layer"
        style={{
          background: `radial-gradient(circle, rgba(232, 121, 249, ${0.28 * op}) 0%, rgba(232, 121, 249, ${0.08 * op}) 35%, transparent 65%)`,
        }}
      />

      {/* Blob 3 — emerald, center, 40vw, 24s drift (subtle accent) */}
      <div
        className="absolute top-1/2 left-1/2 w-[40vw] h-[40vw] rounded-full aurora-blob-3 gpu-layer"
        style={{
          transform: "translate(-50%, -50%)",
          background: `radial-gradient(circle, rgba(61, 214, 140, ${0.15 * op}) 0%, rgba(61, 214, 140, ${0.04 * op}) 40%, transparent 70%)`,
        }}
      />

      {/* Deep vignette to ensure contrast at edges (text legibility) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 70% at 50% 50%, transparent 30%, rgba(10, 11, 14, 0.5) 75%, rgba(10, 11, 14, 0.85) 100%)",
        }}
      />
    </div>
  );
}

const AuroraBackground = memo(AuroraBackgroundImpl);
export default AuroraBackground;

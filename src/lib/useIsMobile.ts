"use client";

import { useEffect, useState } from "react";

/**
 * useIsMobile — SSR-safe mobile breakpoint detection.
 *
 * Returns `false` during SSR / first render to avoid layout shift on mobile,
 * then re-renders with the actual value after mount. Uses matchMedia so the
 * browser handles breakpoint changes (no resize event spam).
 *
 * Breakpoint matches Tailwind's `lg` (1024px) — anything below is "mobile".
 * Used to disable heavy effects (aurora orbs, page transitions, motion.div
 * layout animations) on small screens where they cause jank.
 */
export function useIsMobile(breakpoint = 1024): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    // Safari < 14 only supports addListener
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", update);
      return () => mql.removeEventListener("change", update);
    } else {
      // @ts-expect-error legacy API
      mql.addListener(update);
      // @ts-expect-error legacy API
      return () => mql.removeListener(update);
    }
  }, [breakpoint]);

  return isMobile;
}

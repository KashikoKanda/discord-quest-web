"use client";

/**
 * MotionConfigProvider — app-wide framer-motion configuration.
 *
 * Why a provider:
 *  - `<MotionConfig reducedMotion="user">` makes framer-motion respect the
 *    user's `prefers-reduced-motion` setting automatically across the whole
 *    tree. No need to manually check `useReducedMotion()` in every component.
 *  - `transition={defaultTransition}` sets a sensible spring default so
 *    motion.* elements without an explicit transition still feel "alive"
 *    rather than linear.
 *
 * Performance:
 *  - MotionConfig is a context provider — it doesn't render any DOM and
 *    adds zero runtime cost.
 *  - `reducedMotion="user"` only affects motion when the OS setting is on;
 *    users without the preference see full motion.
 */

import { MotionConfig } from "framer-motion";
import { defaultTransition } from "@/lib/motion";

export function MotionConfigProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={defaultTransition}>
      {children}
    </MotionConfig>
  );
}

"use client";

import { motion } from "framer-motion";
import type { Variants } from "framer-motion";
import { fadeUp, viewportOnce } from "@/lib/motion";
import type { ReactNode } from "react";

/* ────────────────────────────────────────────────────────────────────────
 * MotionSection — thin wrapper around motion.div with the shared `fadeUp`
 * variant + `whileInView` viewport config. Drop-in for any container that
 * should fade-up when scrolled into view.
 *
 * Why a wrapper:
 *  - Avoids repeating `variants={fadeUp} initial="hidden" whileInView="show"
 *    viewport={viewportOnce}` boilerplate in every view file.
 *  - Single place to tweak the entrance variant if the design changes.
 *
 * Performance:
 *  - `viewport={{ once: true, margin: "-50px" }}` fires the IntersectionObserver
 *    once per element — no continuous observation.
 *  - Only `transform` + `opacity` animate.
 *  - When `prefers-reduced-motion` is on, MotionConfig (`reducedMotion="user"`)
 *    converts the animation to an instant opacity fade.
 *
 * Optional `delay` (seconds) — small per-section stagger for visual rhythm.
 * Keep ≤0.12s — long delays feel sluggish.
 * ──────────────────────────────────────────────────────────────────────── */

export function MotionSection({
  children,
  className,
  delay = 0,
  variants = fadeUp,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  variants?: Variants;
}) {
  return (
    <motion.div
      className={className}
      variants={variants}
      initial="hidden"
      whileInView="show"
      viewport={viewportOnce}
      transition={
        delay
          ? { delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }
          : undefined
      }
    >
      {children}
    </motion.div>
  );
}

/**
 * motion.ts — Shared framer-motion primitives for the Aurora UI redesign.
 *
 * Design philosophy:
 *  - All animations are GPU-friendly: they only animate `transform` and
 *    `opacity`. Never `width`, `height`, `top`, `left`, `margin`, `padding`.
 *  - Spring physics preferred over linear/ease timings for "soft, natural"
 *    motion that feels alive without being flashy.
 *  - `viewportOnce` is the default `viewport` config — fires once, with a
 *    -50px margin so elements animate slightly before they enter view (no
 *    "popping in" when the user scrolls fast).
 *  - All variants export a tuple of `initial`/`animate`/`exit` shapes so
 *    callers can use them with both `variants` + `initial/animate` and
 *    `whileInView`.
 *
 * Performance notes:
 *  - We use `type: "spring"` only where spring feel matters (entrance,
 *    layout). `whileInView` uses duration-based tween with `easeOutExpo` to
 *    keep long lists cheap (spring has higher CPU cost when many run
 *    simultaneously).
 *  - `Transition` objects are shared by reference so React doesn't allocate
 *    new ones on every render.
 */

import type { Transition, Variants } from "framer-motion";

/* ─── Easing curves ────────────────────────────────────────────────────── */

/** Out-expo: very fast start, ultra-slow settle. Apple/Raycast feel. */
export const easeOutExpo = [0.16, 1, 0.3, 1] as const;

/** InOut-quart: symmetric slow-in slow-out for state transitions. */
export const easeInOutQuart = [0.77, 0, 0.18, 1] as const;

/** Out-quint: slightly softer than expo, used for hover micro-interactions. */
export const easeOutQuint = [0.22, 1, 0.36, 1] as const;

/** Premium Apple-style ease (kept for backward compat with existing variants). */
export const easePremium = [0.22, 1, 0.36, 1] as const;

/* ─── Spring transitions ───────────────────────────────────────────────── */

/**
 * springSoft — gentle spring for hover lifts, card entrance, large UI blocks.
 * Slightly underdamped so motion settles with a tiny tail (feels "alive").
 */
export const springSoft: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 26,
  mass: 0.9,
};

/**
 * springSnappy — quick, decisive spring for buttons, tabs, icon swaps.
 * Critically damped so motion ends without overshoot (no wobble).
 */
export const springSnappy: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 30,
  mass: 0.8,
};

/**
 * springGentle — slow, low-amplitude spring for ambient motion (logo glow
 * halo, status dots). Low stiffness + high damping = no overshoot, glacial
 * feel. Used sparingly to avoid heating.
 */
export const springGentle: Transition = {
  type: "spring",
  stiffness: 120,
  damping: 22,
  mass: 1.0,
};

/**
 * layoutSpring — used with `<motion.div layout />` for the active tab
 * indicator and shared-layout transitions. Snappy but not bouncy so the
 * indicator stays glued to the cursor without trailing.
 */
export const layoutSpring: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32,
  mass: 0.7,
};

/* ─── Viewport config ──────────────────────────────────────────────────── */

/**
 * viewportOnce — the default `viewport` prop for `whileInView`.
 * `once: true` means the animation fires exactly once per element (no
 * re-firing on scroll up/down). `-50px` margin pre-triggers the animation
 * so elements are slightly pre-animated when they enter the viewport,
 * avoiding "pop-in" on fast scrolls.
 *
 * Use: `<motion.div variants={fadeUp} initial="hidden" whileInView="show"
 *       viewport={viewportOnce} />`
 */
export const viewportOnce = {
  once: true,
  margin: "-50px",
} as const;

/* ─── Variants ────────────────────────────────────────────────────────── */

/**
 * fadeUp — the workhorse. Soft fade + 8px upward translate.
 * Used for cards, list items, section headers — anywhere a subtle "rise in"
 * feels right. 0.4s with easeOutExpo — fast enough not to feel sluggish,
 * slow enough to be perceived as intentional.
 */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: easeOutExpo },
  },
  exit: {
    opacity: 0,
    y: -4,
    transition: { duration: 0.2, ease: easeInOutQuart },
  },
};

/**
 * fadeDown — mirror of fadeUp, for elements entering from above (rare use:
 * back navigation, sticky headers sliding in).
 */
export const fadeDown: Variants = {
  hidden: { opacity: 0, y: -8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: easeOutExpo },
  },
  exit: {
    opacity: 0,
    y: 4,
    transition: { duration: 0.2, ease: easeInOutQuart },
  },
};

/**
 * fadeIn — opacity-only fade. Used for elements where transform would
 * cause layout shift (e.g., badge swaps) or for reduced-motion fallbacks.
 */
export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: 0.3, ease: easeOutExpo },
  },
  exit: {
    opacity: 0,
    transition: { duration: 0.15, ease: easeInOutQuart },
  },
};

/**
 * scaleIn — modal/toast/popover entrance. Slight 0.96 → 1 scale with fade.
 * The 0.04 scale delta is small enough to feel premium (not a "pop"), large
 * enough to be perceived.
 */
export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.28, ease: easeOutExpo },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: { duration: 0.18, ease: easeInOutQuart },
  },
};

/**
 * slideInLeft — sidebar / drawer entrance. 16px translate, slightly longer
 * duration because horizontal motion reads as "more deliberate".
 */
export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -16 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.32, ease: easeOutExpo },
  },
  exit: {
    opacity: 0,
    x: -12,
    transition: { duration: 0.2, ease: easeInOutQuart },
  },
};

/**
 * slideInRight — mirror of slideInLeft, for "next" navigation or
 * right-anchored drawers.
 */
export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 16 },
  show: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.32, ease: easeOutExpo },
  },
  exit: {
    opacity: 0,
    x: 12,
    transition: { duration: 0.2, ease: easeInOutQuart },
  },
};

/**
 * staggerContainer — parent variant that staggers its children by 40ms.
 * Pair with `fadeUp` (or any of the above) on the children.
 *
 * Usage:
 *   <motion.ul variants={staggerContainer} initial="hidden" animate="show">
 *     <motion.li variants={fadeUp} />  // each child staggered 40ms
 *   </motion.ul>
 *
 * Cap staggerChildren at 0.04s — long staggers (0.1s+) feel sluggish on
 * lists of 20+ items.
 */
export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.02,
    },
  },
  exit: {
    opacity: 0,
    transition: { staggerChildren: 0.02, staggerDirection: -1 },
  },
};

/**
 * staggerContainerFast — 20ms stagger, for short lists (≤5 items) where the
 * stagger should be perceived as "wave" not "march".
 */
export const staggerContainerFast: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.02,
      delayChildren: 0.01,
    },
  },
};

/* ─── Default transition (used by MotionConfig) ────────────────────────── */

/**
 * defaultTransition — the app-wide default for any motion.* element that
 * doesn't specify its own `transition`. Spring physics for "alive" feel,
 * critically damped so there's no overshoot on UI state changes.
 */
export const defaultTransition: Transition = {
  type: "spring",
  stiffness: 280,
  damping: 28,
  mass: 0.85,
};

/* ─── Page transitions (used by page.tsx) ──────────────────────────────── */

/**
 * pageVariants — used by the desktop page-level AnimatePresence. Kept short
 * (0.3s) for snappy tab switches; mobile skips page transitions entirely
 * (the tree re-mounts are too expensive).
 */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.3, ease: easeOutExpo },
  },
  exit: {
    opacity: 0,
    y: -8,
    scale: 1.01,
    transition: { duration: 0.2, ease: easeInOutQuart },
  },
};

/* Re-export Transition type for callers who need it (keeps imports tidy). */
export type { Transition };

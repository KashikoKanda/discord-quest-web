import * as React from "react"

import { cn } from "@/lib/utils"

/* ────────────────────────────────────────────────────────────────────────
 * Input — premium focus ring with brand-colored glow.
 *
 * On focus:
 *  - Border shifts to brand indigo (#5E6AD2 at 50% alpha).
 *  - Soft outer glow: 0 0 0 1px indigo alpha + 0 0 18px indigo alpha.
 *  - Background brightens slightly (rgba white 0.05) for depth.
 *
 * The focus ring is animated via `transition-[color,box-shadow,border-color]`
 * only — never layout. 200ms with the premium ease curve.
 *
 * Backward compatible: existing className overrides still work because we
 * append the focus-ring classes BEFORE the user's className (so user styles
 * can still override).
 * ──────────────────────────────────────────────────────────────────────── */

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground " +
          "dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 " +
          "text-base shadow-xs outline-none " +
          "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium " +
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm " +
          // Premium focus: brand-color ring + soft outer glow. Box-shadow
          // animation only — GPU-friendly, no layout reflow.
          "transition-[color,box-shadow,border-color,background-color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
          "focus-visible:border-[rgba(94,106,210,0.5)] " +
          "focus-visible:ring-[3px] focus-visible:ring-[rgba(94,106,210,0.35)] " +
          "focus-visible:shadow-[0_0_0_1px_rgba(94,106,210,0.4),0_0_18px_rgba(94,106,210,0.2)] " +
          "dark:focus-visible:bg-white/[0.03] " +
          "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/* ────────────────────────────────────────────────────────────────────────
 * Badge — premium aurora variants.
 *
 * New variants:
 *  - `gradient` — aurora gradient background (indigo → sky → fuchsia),
 *    subtle inner highlight. Used for status pills that should "pop".
 *  - Existing variants (`default`, `secondary`, `destructive`, `outline`)
 *    preserved exactly so existing callers don't break.
 *
 * Performance: gradient variant uses a static linear-gradient (no animation).
 * ──────────────────────────────────────────────────────────────────────── */

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive transition-[color,box-shadow,border-color] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive:
          "border-transparent bg-destructive text-white [a&]:hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        // Aurora gradient badge — soft static gradient, no animation.
        // Inner highlight via box-shadow inset (cheap, GPU-composited).
        gradient:
          "border-transparent text-white " +
          "bg-[linear-gradient(135deg,#5E6AD2_0%,#38BDF8_50%,#E879F9_100%)] " +
          "shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_1px_3px_rgba(94,106,210,0.35)] " +
          "[a&]:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_2px_8px_rgba(94,106,210,0.5)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }

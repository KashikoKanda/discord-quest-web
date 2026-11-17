import * as React from "react"

import { cn } from "@/lib/utils"

/* ────────────────────────────────────────────────────────────────────────
 * Card — premium aurora surface with subtle hover lift (CSS-only).
 *
 * Design tokens:
 *  - Hover: translateY(-2px) lift + border highlight + soft shadow growth.
 *  - All transitions use the --ease-out-premium curve.
 *  - GPU-friendly: only `transform`, `box-shadow`, `border-color` transition.
 *
 * The `Card` component itself receives the hover lift — this is opt-in
 * via the `interactive` prop so non-interactive cards (e.g. wrappers around
 * static content) don't accidentally lift on hover. Existing callers that
 * don't pass `interactive` continue to render exactly as before.
 * ──────────────────────────────────────────────────────────────────────── */

function Card({
  className,
  interactive = false,
  ...props
}: React.ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      data-slot="card"
      className={cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        // Only apply the hover lift when explicitly marked interactive.
        // This keeps the base Card API backward-compatible (existing static
        // cards don't suddenly start animating on hover).
        interactive &&
          "transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform hover:-translate-y-0.5 hover:border-white/[0.14] hover:shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset,0_12px_32px_rgba(0,0,0,0.4)]",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("leading-none font-semibold", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}

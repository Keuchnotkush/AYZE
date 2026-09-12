import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "contrast" | "outline" | "ghost";
type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center rounded-control font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olympic focus-visible:ring-offset-2 " +
  "disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-olympic text-white hover:bg-olympic-deep",
  /* Ink on surface: white on dark containers, tyrian on light ones. */
  contrast: "bg-ink text-surface hover:bg-ink/90 focus-visible:ring-ink focus-visible:ring-offset-surface",
  outline:
    "border border-ink text-ink hover:bg-ink/10 focus-visible:ring-offset-transparent",
  ghost: "text-ink hover:bg-ink/10 focus-visible:ring-offset-transparent",
};

const sizes: Record<Size, string> = {
  md: "h-10 px-5 text-sm",
  lg: "h-12 px-7 text-base",
};

type StyleProps = { variant?: Variant; size?: Size; className?: string };

function classes({ variant = "primary", size = "md", className }: StyleProps) {
  return cn(base, variants[variant], sizes[size], className);
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & StyleProps) {
  return <button type={type} className={classes({ variant, size, className })} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & StyleProps) {
  return <Link className={classes({ variant, size, className })} {...props} />;
}

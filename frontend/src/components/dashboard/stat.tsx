import type { ReactNode } from "react";
import { Badge as UiBadge } from "@/components/ui/badge";
import { Card as UiCard, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/cn";

type StatProps = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  className?: string;
  /** No border or padding: for stats laid out inside a card. */
  plain?: boolean;
};

/** Single figure with a label above and an optional hint below. */
export function Stat({ label, value, hint, className, plain }: StatProps) {
  return (
    <div className={cn("flex flex-col gap-1", !plain && "rounded-control border border-ink/15 px-4 py-3.5", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-ink/55">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-ink/60">{hint}</span>}
    </div>
  );
}

/** Bordered section with an optional title (shadcn Card, AYZE spacing: p-5, gap-4). */
export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <UiCard className={cn("gap-4 overflow-visible rounded-control py-5 text-ink ring-ink/15", className)}>
      {title && (
        <CardHeader className="px-5">
          <CardTitle className="text-base font-semibold">{title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-4 px-5">{children}</CardContent>
    </UiCard>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "accent";
const tones: Record<Tone, string> = {
  neutral: "bg-ink/10 text-ink",
  good: "bg-emerald-500/15 text-emerald-700",
  warn: "bg-amber-500/15 text-amber-700",
  bad: "bg-red-500/15 text-red-700",
  accent: "bg-olympic/15 text-olympic-deep",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <UiBadge variant="outline" className={cn("h-auto rounded-full border-transparent px-2.5 py-0.5 font-medium", tones[tone])}>
      {children}
    </UiBadge>
  );
}

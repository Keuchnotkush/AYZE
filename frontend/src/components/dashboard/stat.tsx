import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type StatProps = { label: string; value: ReactNode; hint?: ReactNode; className?: string };

/** Single figure with a label above and an optional hint below. */
export function Stat({ label, value, hint, className }: StatProps) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-control border border-ink/15 px-4 py-3.5", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-ink/55">{label}</span>
      <span className="text-xl font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-xs text-ink/60">{hint}</span>}
    </div>
  );
}

export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-control border border-ink/15 p-5", className)}>
      {title && <h2 className="text-base font-semibold">{title}</h2>}
      {children}
    </section>
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
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>
      {children}
    </span>
  );
}

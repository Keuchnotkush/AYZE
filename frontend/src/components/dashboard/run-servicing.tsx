"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ServicingReport } from "@/server/servicing";

/** Triggers one servicing pass (auto-debit, auto-default, escrow release) and refreshes the page. */
export function RunServicing({ className }: { className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [summary, setSummary] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      try {
        const res = await fetch("/api/servicing/run", { method: "POST", cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = (await res.json()) as ServicingReport;
        setSummary(`${r.paid.length} paid · ${r.failed.length} failed · ${r.defaulted.length} defaulted · ${r.released.length} released${r.errors.length ? ` · ${r.errors.length} errors` : ""}`);
        router.refresh();
      } catch (e) {
        setSummary(e instanceof Error ? e.message : String(e));
      }
    });

  return (
    <div className={className ?? "flex flex-col items-end gap-1"}>
      <Button variant="outline" onClick={run} disabled={pending}>
        {pending ? "Servicing…" : "Run servicing now"}
      </Button>
      {summary && <span className="text-xs text-ink/60 tabular-nums" role="status">{summary}</span>}
    </div>
  );
}

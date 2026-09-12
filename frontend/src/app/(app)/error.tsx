"use client";

import { Button } from "@/components/ui/button";

/** Surfaces a dropped ledger connection or a registry problem. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex max-w-xl flex-col gap-4 rounded-control border border-red-400/40 bg-red-500/5 p-6">
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="text-sm text-ink/80">{error.message}</p>
      <Button onClick={reset} variant="outline" className="self-start">
        Retry
      </Button>
    </div>
  );
}

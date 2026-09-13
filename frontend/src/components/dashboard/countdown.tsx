"use client";

import { useEffect, useState } from "react";
import { fmtDuration } from "@/lib/format";

/**
 * Ticks a server-provided number of seconds once a second, so "in 1m 20s" keeps moving between two
 * server refreshes. Each new server value re-anchors the count (elapsed is measured from mount or
 * from the last change of `seconds`).
 */
export function Countdown({ seconds, className }: { seconds: number; className?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => {
      clearInterval(id);
      setElapsed(0);
    };
  }, [seconds]);
  return (
    <span className={className} suppressHydrationWarning>
      {fmtDuration(seconds - elapsed)}
    </span>
  );
}

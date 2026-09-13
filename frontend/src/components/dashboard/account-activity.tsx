"use client";

import { useEffect, useState } from "react";
import { Stat } from "@/components/dashboard/stat";
import { txUrl } from "@/lib/format";
import type { AccountActivity as Activity } from "@/server/ledger";

const REFRESH_MS = 10_000;

type Props = { address: string; label?: string; className?: string };

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** Raw XRP balance (as the explorer shows it) and last validated transaction, polled from the ledger every 10 s. */
export function AccountActivity({ address, label = "Live balance", className }: Props) {
  const [data, setData] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/accounts/${address}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Activity;
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [address]);

  const last = data?.lastTx;
  const value = data ? (data.xrp === null ? "not funded" : `${data.xrp.toLocaleString(undefined, { maximumFractionDigits: 6 })} XRP`) : "…";
  const hint = error ? (
    <span className="text-red-700">ledger unreachable</span>
  ) : last ? (
    <span className="flex flex-wrap gap-x-1.5 tabular-nums">
      <span>{last.type}</span>
      <span className={last.direction === "in" ? "text-emerald-700" : undefined}>{last.amount}</span>
      {last.date && <span>· {time(last.date)}</span>}
      <a href={txUrl(last.hash)} target="_blank" rel="noreferrer" className="font-mono underline-offset-4 hover:underline">
        {last.hash.slice(0, 8)}…
      </a>
    </span>
  ) : data ? (
    "no transaction yet"
  ) : undefined;

  return <Stat label={label} value={value} hint={hint} className={className} />;
}

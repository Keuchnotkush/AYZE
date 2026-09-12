import type { ReactNode } from "react";
import { Address } from "@/components/dashboard/address";
import { LoanStatusBadge } from "@/components/dashboard/loan-status";
import { Badge, Card } from "@/components/dashboard/stat";
import { fmtDate, fmtDuration, fmtUSD } from "@/lib/format";
import type { LoanView } from "@/server/views";

const TONE = { LOCKED: "accent", CLAIMED: "good", EXPIRED: "neutral" } as const;

type LoanCardProps = {
  loan: LoanView;
  /** Which counterparties to show (the viewer's own side is implicit). */
  show?: Array<"borrower" | "broker" | "vault" | "seller">;
  actions?: ReactNode;
  children?: ReactNode;
};

/** One loan: terms, ledger state, schedule progress, guarantee — plus the caller's actions. */
export function LoanCard({ loan, show = ["borrower", "vault", "seller"], actions, children }: LoanCardProps) {
  const closed = loan.status !== "active";
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold">{fmtUSD(loan.principal)}</span>
            <LoanStatusBadge loan={loan} />
          </div>
          <span className="text-xs text-ink/60">
            {loan.paymentTotal} × {fmtUSD(loan.principal / loan.paymentTotal)} every {loan.paymentInterval}s · grace {loan.gracePeriod}s · 6 % interest ({fmtUSD(loan.interestTotal)})
          </span>
          <span className="flex flex-wrap gap-x-3 text-xs text-ink/60">
            {show.includes("vault") && <span>Vault {loan.vault.name}</span>}
            {show.includes("borrower") && <span>Borrower {loan.borrower.company} <Address value={loan.borrower.address} /></span>}
            {show.includes("broker") && <span>Broker {loan.broker.company} <Address value={loan.broker.address} /></span>}
            {show.includes("seller") && (
              <span>{loan.guarantee ? <>Protected by {loan.guarantee.seller.company} <Address value={loan.guarantee.seller.address} /></> : "No protection seller yet"}</span>
            )}
          </span>
        </div>
        <div className="text-right text-sm">
          <div className="tabular-nums">{loan.paidCount} / {loan.paymentTotal} paid</div>
          {loan.nextDue && !closed && (
            <div className="text-xs text-ink/60">
              next #{loan.nextDue.index} {fmtDate(loan.nextDue.dueDate)} ({fmtDuration(loan.nextDue.secondsToDue)}) · default {fmtDuration(loan.nextDue.secondsToDefault)}
            </div>
          )}
          <div className="text-xs text-ink/60">
            cover {fmtUSD(loan.cover)} → on ledger {fmtUSD(loan.coverAvailable)}
          </div>
        </div>
      </div>

      {loan.guarantee && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink/60">Escrows (40 % of each instalment):</span>
          {loan.guarantee.escrows.map((e) => (
            <span key={e.escrowID} className="inline-flex items-center gap-1">
              <Badge tone={TONE[e.status as keyof typeof TONE] ?? "neutral"}>
                #{e.index} {fmtUSD(e.amount)} · {e.status.toLowerCase()}
              </Badge>
            </span>
          ))}
          <span className="text-ink/60">locked {fmtUSD(loan.guarantee.locked)} · claimed {fmtUSD(loan.guarantee.claimed)}</span>
        </div>
      )}

      {children}
      {actions && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{actions}</div>}
    </Card>
  );
}

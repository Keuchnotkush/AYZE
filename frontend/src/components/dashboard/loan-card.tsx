import type { ReactNode } from "react";
import { Address } from "@/components/dashboard/address";
import { LoanStatusBadge } from "@/components/dashboard/loan-status";
import { Badge, Card } from "@/components/dashboard/stat";
import { fmtDate, fmtDuration, fmtXRP, txUrl } from "@/lib/format";
import type { InstalmentStatus, LoanView } from "@/server/views";

type Tone = "neutral" | "good" | "warn" | "bad" | "accent";

type EscrowStatus = NonNullable<LoanView["guarantee"]>["escrows"][number]["status"];

const ESCROW: Record<EscrowStatus, { label: string; tone: Tone }> = {
  LOCKED: { label: "Locked", tone: "accent" },
  CLAIMED: { label: "Claimed", tone: "good" },
  RELEASED: { label: "Released", tone: "neutral" },
  EXPIRED: { label: "Released", tone: "neutral" },
};

const INSTALMENT: Record<InstalmentStatus, { label: string; tone: Tone }> = {
  paid: { label: "Paid", tone: "good" },
  upcoming: { label: "Due", tone: "neutral" },
  due: { label: "Due", tone: "warn" },
  late: { label: "Late", tone: "bad" },
  defaulted: { label: "Defaulted", tone: "bad" },
};

function Tx({ hash }: { hash: string }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="font-mono underline underline-offset-4">
      {hash.slice(0, 6)}…
    </a>
  );
}

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
            <span className="text-base font-semibold">{fmtXRP(loan.principal)}</span>
            <LoanStatusBadge loan={loan} />
          </div>
          <span className="text-xs text-ink/60">
            {loan.paymentTotal} × {fmtXRP(loan.principal / loan.paymentTotal)} every {loan.paymentInterval}s · grace {loan.gracePeriod}s · 6 % interest ({fmtXRP(loan.interestTotal)}) · auto-debit
            {loan.defaultedBy && <> · defaulted by {loan.defaultedBy === "auto" ? "servicing" : "broker"}</>}
          </span>
          {loan.ayzeFeePending && (
            <span className="text-xs text-amber-700" title={loan.ayzeFeePending}>
              AYZE fee not collected yet — retried by servicing ({loan.ayzeFeePending})
            </span>
          )}
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
            cover {fmtXRP(loan.cover)} · vault cover {fmtXRP(loan.coverAvailable)}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-ink/60">Instalments:</span>
        {loan.schedule.map((i) => (
          <span key={i.index} className="inline-flex items-center gap-1" title={i.error ?? undefined}>
            <Badge tone={INSTALMENT[i.status].tone}>
              #{i.index} {fmtXRP(i.principal + i.interest)} · {INSTALMENT[i.status].label} {i.status === "upcoming" ? fmtDate(i.dueDate) : ""}
              {i.status === "late" && i.error && <span className="ml-1 font-normal">(auto-debit failed: {i.error})</span>}
            </Badge>
            {i.txHash && <Tx hash={i.txHash} />}
          </span>
        ))}
      </div>

      {loan.guarantee && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink/60">Escrows (40 % of each instalment):</span>
          {loan.guarantee.escrows.map((e) => (
            <span key={e.escrowID} className="inline-flex items-center gap-1" title={`CancelAfter ${fmtDate(e.cancelAfter)}`}>
              <Badge tone={ESCROW[e.status].tone}>
                #{e.index} {fmtXRP(e.amount)} · {ESCROW[e.status].label}
              </Badge>
              {e.txHash && <Tx hash={e.txHash} />}
            </span>
          ))}
          <span className="text-ink/60">locked {fmtXRP(loan.guarantee.locked)} · claimed {fmtXRP(loan.guarantee.claimed)} · released {fmtXRP(loan.guarantee.released)}</span>
        </div>
      )}

      {children}
      {actions && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{actions}</div>}
    </Card>
  );
}

import type { ReactNode } from "react";
import { Address } from "@/components/dashboard/address";
import { Countdown } from "@/components/dashboard/countdown";
import { LoanStatusBadge } from "@/components/dashboard/loan-status";
import { Badge, Card } from "@/components/dashboard/stat";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtDate, fmtXRP, txUrl } from "@/lib/format";
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
  upcoming: { label: "Upcoming", tone: "neutral" },
  due: { label: "Due", tone: "warn" },
  late: { label: "Late", tone: "bad" },
  defaulted: { label: "Defaulted", tone: "bad" },
};

function Tx({ hash }: { hash: string }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-ink/60 underline-offset-4 hover:underline">
      {hash.slice(0, 6)}…
    </a>
  );
}

/** One `a · b · c` line where every item is separated by a thin vertical rule. */
function Terms({ items }: { items: ReactNode[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink/60">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-2.5">
          {i > 0 && <Separator orientation="vertical" className="h-3" />}
          {item}
        </span>
      ))}
    </div>
  );
}

type LoanCardProps = {
  loan: LoanView;
  /** Which counterparties to show (the viewer's own side is implicit). */
  show?: Array<"borrower" | "broker" | "vault" | "seller">;
  actions?: ReactNode;
  children?: ReactNode;
};

/** One loan: terms, ledger state, a per-instalment timeline (with the matching escrow underneath), the caller's actions. */
export function LoanCard({ loan, show = ["borrower", "vault", "seller"], actions, children }: LoanCardProps) {
  const closed = loan.status !== "active";
  const escrowByIndex = new Map((loan.guarantee?.escrows ?? []).map((e) => [e.index, e]));
  const perInstalment = loan.principal / loan.paymentTotal;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold tabular-nums">{fmtXRP(loan.principal)}</span>
            <LoanStatusBadge loan={loan} />
            {loan.defaultedBy && <span className="text-xs text-ink/60">defaulted by {loan.defaultedBy === "auto" ? "servicing" : "broker"}</span>}
          </div>
          <Terms
            items={[
              <>{loan.paymentTotal} × {fmtXRP(perInstalment)}</>,
              <>every {loan.paymentInterval}s</>,
              <>grace {loan.gracePeriod}s</>,
              <>6 % interest = {fmtXRP(loan.interestTotal)}</>,
              <>auto-debit</>,
            ]}
          />
          <span className="flex flex-wrap gap-x-3 text-xs text-ink/60">
            {show.includes("vault") && <span>Vault {loan.vault.name}</span>}
            {show.includes("borrower") && <span>Borrower {loan.borrower.company} <Address value={loan.borrower.address} /></span>}
            {show.includes("broker") && <span>Broker {loan.broker.company} <Address value={loan.broker.address} /></span>}
            {show.includes("seller") && (
              <span>{loan.guarantee ? <>Protected by {loan.guarantee.seller.company} <Address value={loan.guarantee.seller.address} /></> : "No protection seller yet"}</span>
            )}
          </span>
          {loan.ayzeFeePending && (
            <span className="flex items-center gap-2 text-xs">
              <Badge tone="warn">AYZE fee pending</Badge>
              <span className="text-ink/60">retried by servicing ({loan.ayzeFeePending})</span>
            </span>
          )}
        </div>

        <div className="flex min-w-44 flex-col gap-1.5 text-right text-sm">
          <div className="flex items-center justify-end gap-2 tabular-nums">
            <span>{loan.paidCount} / {loan.paymentTotal} paid</span>
            <Progress value={(loan.paidCount / loan.paymentTotal) * 100} className="h-1.5 w-24" aria-label="Instalments paid" />
          </div>
          {loan.nextDue && !closed && (
            <div className="text-xs text-ink/60 tabular-nums">
              next #{loan.nextDue.index} <Countdown seconds={loan.nextDue.secondsToDue} /> · default <Countdown seconds={loan.nextDue.secondsToDefault} />
            </div>
          )}
          <div className="text-xs text-ink/60">cover {fmtXRP(loan.cover)} · vault cover {fmtXRP(loan.coverAvailable)}</div>
        </div>
      </div>

      {/* Timeline: one column per instalment, its escrow (when guaranteed) right underneath. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <ol className="grid min-w-max gap-2 sm:min-w-0" style={{ gridTemplateColumns: `repeat(${loan.paymentTotal}, minmax(7.5rem, 1fr))` }}>
          {loan.schedule.map((i) => {
            const escrow = escrowByIndex.get(i.index);
            return (
              <li key={i.index} className="flex flex-col gap-1.5 rounded-control border border-ink/10 px-2.5 py-2 text-xs">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">#{i.index}</span>
                  <span className="text-ink/60 tabular-nums">{fmtDate(i.dueDate)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={INSTALMENT[i.status].tone}>{INSTALMENT[i.status].label}</Badge>
                  <span className="tabular-nums">{fmtXRP(i.principal + i.interest)}</span>
                  {i.txHash && <Tx hash={i.txHash} />}
                </div>
                {i.status === "late" && i.error && (
                  <Tooltip>
                    <TooltipTrigger render={<p className="line-clamp-2 text-[11px] text-red-700" />}>
                      auto-debit failed: {i.error}
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{i.error}</TooltipContent>
                  </Tooltip>
                )}
                {escrow && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-ink/10 pt-1.5" title={`Escrow · CancelAfter ${fmtDate(escrow.cancelAfter)}`}>
                    <Badge tone={ESCROW[escrow.status].tone}>{ESCROW[escrow.status].label}</Badge>
                    <span className="tabular-nums text-ink/70">{fmtXRP(escrow.amount)}</span>
                    {escrow.txHash && <Tx hash={escrow.txHash} />}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      {loan.guarantee && (
        <p className="-mt-2 text-xs text-ink/60">
          Escrows (40 % of each instalment): locked {fmtXRP(loan.guarantee.locked)} · claimed {fmtXRP(loan.guarantee.claimed)} · released {fmtXRP(loan.guarantee.released)}
        </p>
      )}

      {children}
      {actions && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{actions}</div>}
    </Card>
  );
}

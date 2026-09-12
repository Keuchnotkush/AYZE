import Link from "next/link";
import { LoanCard } from "@/components/dashboard/loan-card";
import { Card, Stat } from "@/components/dashboard/stat";
import { TxForm } from "@/components/dashboard/tx-form";
import { fmtUSD } from "@/lib/format";
import { payInstalmentAction, repayInFullAction } from "@/server/actions";
import { requireRole } from "@/server/auth/session";
import { loansWhere, walletView } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function BorrowerPage() {
  const borrower = await requireRole("borrower");
  const [loans, wallet] = await Promise.all([loansWhere((l) => l.borrowerId === borrower.id), walletView(borrower)]);
  loans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My loans</h1>
          <p className="text-sm text-ink/60">
            Each instalment pays principal to the vault and 6 % flat interest split 50 % protection seller · 30 % broker · 20 % lenders.
          </p>
        </div>
        <Stat label="Wallet" value={fmtUSD(wallet.usd)} />
      </div>

      {loans.length === 0 && (
        <Card>
          <p className="text-sm text-ink/70">
            No loan yet. <Link href="/market" className="underline underline-offset-4">Pick a vault on the marketplace</Link> to borrow 1 000 USD.
          </p>
        </Card>
      )}

      {loans.map((loan) => {
        const payable = loan.status === "active" && loan.ledgerStatus !== "defaulted" && loan.ledgerStatus !== "repaid";
        const due = loan.nextDue;
        return (
          <LoanCard
            key={loan.id}
            loan={loan}
            show={["vault", "broker", "seller"]}
            actions={
              <>
                <TxForm
                  inline
                  action={payInstalmentAction}
                  hidden={{ loanId: loan.id }}
                  submitLabel={due ? `Pay instalment #${due.index} (${fmtUSD(due.principal + due.interest)})` : "Pay instalment"}
                  disabled={!payable}
                  disabledReason={payable ? (loan.ledgerStatus === "late" || loan.ledgerStatus === "defaultable" ? "Overdue — the broker may declare default." : undefined) : "Nothing to pay."}
                />
                <TxForm
                  inline
                  action={repayInFullAction}
                  hidden={{ loanId: loan.id }}
                  submitLabel="Repay everything"
                  variant="outline"
                  disabled={!payable}
                />
              </>
            }
          />
        );
      })}
    </>
  );
}

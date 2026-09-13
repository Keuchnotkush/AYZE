import { HandCoins } from "lucide-react";
import { AccountActivity } from "@/components/dashboard/account-activity";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoanCard } from "@/components/dashboard/loan-card";
import { Forbidden } from "@/components/dashboard/forbidden";
import { Stat } from "@/components/dashboard/stat";
import { TxForm } from "@/components/dashboard/tx-form";
import { ButtonLink } from "@/components/ui/button";
import { fmtXRP } from "@/lib/format";
import { payInstalmentAction, repayInFullAction } from "@/server/actions";
import { pageRole } from "@/server/auth/session";
import { loansWhere, walletView } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function BorrowerPage() {
  const gate = await pageRole("borrower");
  if (gate.user === null) return <Forbidden message={gate.forbidden} />;
  const borrower = gate.user;
  const [loans, wallet] = await Promise.all([loansWhere((l) => l.borrowerId === borrower.id), walletView(borrower)]);
  loans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">My loans</h1>
        <div className="flex flex-wrap gap-3">
          <Stat label="Wallet" value={fmtXRP(wallet.xrp)} />
          <AccountActivity address={wallet.address} />
        </div>
      </div>

      {loans.length === 0 && (
        <EmptyState
          icon={HandCoins}
          title="No loan yet"
          hint="Pick a vault on the marketplace, get verified for it, then borrow a 1 000 XRP ticket. Instalments are auto-debited from your wallet."
          action={<ButtonLink href="/market">Go to the marketplace</ButtonLink>}
        />
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
                  submitLabel={due ? `Pay instalment #${due.index} (${fmtXRP(due.principal + due.interest)})` : "Pay instalment"}
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

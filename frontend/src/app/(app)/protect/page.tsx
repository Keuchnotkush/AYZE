import { AccountActivity } from "@/components/dashboard/account-activity";
import { LoanCard } from "@/components/dashboard/loan-card";
import { Forbidden } from "@/components/dashboard/forbidden";
import { Card, Stat } from "@/components/dashboard/stat";
import { TxForm } from "@/components/dashboard/tx-form";
import { fmtXRP } from "@/lib/format";
import { guaranteeAction } from "@/server/actions";
import { pageRole } from "@/server/auth/session";
import { loansWhere, walletView } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function ProtectPage() {
  const gate = await pageRole("protection-seller");
  if (gate.user === null) return <Forbidden message={gate.forbidden} />;
  const seller = gate.user;
  const [open, mine, wallet] = await Promise.all([
    loansWhere((l) => l.status === "active" && !l.guarantee),
    loansWhere((l) => l.guarantee?.protectionSellerId === seller.id),
    walletView(seller),
  ]);
  mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const locked = mine.reduce((sum, l) => sum + (l.guarantee?.locked ?? 0), 0);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Protection</h1>
        <div className="flex flex-wrap gap-3">
          <Stat label="Wallet" value={fmtXRP(wallet.xrp)} />
          <Stat label="Locked" value={fmtXRP(locked)} hint={`${mine.length} loans protected`} />
          <AccountActivity address={wallet.address} />
        </div>
      </div>

      <h2 className="text-lg font-semibold">Loans seeking protection</h2>
      {open.length === 0 && (
        <Card>
          <p className="text-sm text-ink/70">No loan seeking protection.</p>
        </Card>
      )}
      {open.map((loan) => (
        <LoanCard
          key={loan.id}
          loan={loan}
          show={["vault", "broker", "borrower"]}
          actions={
            <TxForm
              inline
              action={guaranteeAction}
              hidden={{ loanId: loan.id }}
              submitLabel={`Guarantee (${fmtXRP((loan.principal - (loan.paidCount * loan.principal) / loan.paymentTotal) * 0.4)} locked, ${fmtXRP(loan.interestTotal * 0.5)} premium)`}
              disabled={loan.ledgerStatus === "defaultable" || loan.ledgerStatus === "late"}
              disabledReason={loan.ledgerStatus === "defaultable" || loan.ledgerStatus === "late" ? "This loan is already overdue." : undefined}
            />
          }
        />
      ))}

      <h2 className="text-lg font-semibold">My guarantees</h2>
      {mine.length === 0 && (
        <Card>
          <p className="text-sm text-ink/70">No guarantee yet.</p>
        </Card>
      )}
      {mine.map((loan) => (
        <LoanCard key={loan.id} loan={loan} show={["vault", "broker", "borrower"]} />
      ))}
    </>
  );
}

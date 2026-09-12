import { LoanCard } from "@/components/dashboard/loan-card";
import { Card, Stat } from "@/components/dashboard/stat";
import { TxForm } from "@/components/dashboard/tx-form";
import { fmtUSD } from "@/lib/format";
import { guaranteeAction } from "@/server/actions";
import { requireRole } from "@/server/auth/session";
import { loansWhere, walletView } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function ProtectPage() {
  const seller = await requireRole("protection-seller");
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
        <div>
          <h1 className="text-2xl font-semibold">Protection</h1>
          <p className="text-sm text-ink/60">
            Guarantee a loan: lock 40 % of each remaining instalment in conditional escrows to the broker, earn 50 % of the 6 % interest.
            On default the broker claims the escrows of the missed instalments; the rest returns to you.
          </p>
        </div>
        <div className="flex gap-3">
          <Stat label="Wallet" value={fmtUSD(wallet.usd)} />
          <Stat label="Locked" value={fmtUSD(locked)} hint={`${mine.length} loans protected`} />
        </div>
      </div>

      <h2 className="text-lg font-semibold">Loans seeking protection</h2>
      {open.length === 0 && (
        <Card>
          <p className="text-sm text-ink/70">Every active loan is protected. New loans appear here as borrowers draw from the vaults.</p>
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
              submitLabel={`Guarantee (${fmtUSD((loan.principal - (loan.paidCount * loan.principal) / loan.paymentTotal) * 0.4)} locked, ${fmtUSD(loan.interestTotal * 0.5)} premium)`}
              disabled={loan.ledgerStatus === "defaultable" || loan.ledgerStatus === "late"}
              disabledReason={loan.ledgerStatus === "defaultable" || loan.ledgerStatus === "late" ? "This loan is already overdue." : undefined}
            />
          }
        />
      ))}

      <h2 className="text-lg font-semibold">My guarantees</h2>
      {mine.length === 0 && (
        <Card>
          <p className="text-sm text-ink/70">You have not guaranteed any loan yet.</p>
        </Card>
      )}
      {mine.map((loan) => (
        <LoanCard key={loan.id} loan={loan} show={["vault", "broker", "borrower"]} />
      ))}
    </>
  );
}

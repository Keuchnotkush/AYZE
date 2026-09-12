import Link from "next/link";
import { notFound } from "next/navigation";
import { Address } from "@/components/dashboard/address";
import { LoanCard } from "@/components/dashboard/loan-card";
import { Card, Stat } from "@/components/dashboard/stat";
import { TxForm } from "@/components/dashboard/tx-form";
import { fmtUSD } from "@/lib/format";
import { claimInsuranceAction, closeLoanAction, declareDefaultAction } from "@/server/actions";
import { requireRole } from "@/server/auth/session";
import { findVault } from "@/server/registry";
import { listVaults, loansWhere } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function BrokerVaultPage({ params }: PageProps<"/broker/vaults/[id]">) {
  const broker = await requireRole("broker");
  const { id } = await params;
  const vault = findVault(id);
  if (!vault || vault.brokerId !== broker.id) notFound();
  const [[view], loans] = await Promise.all([listVaults((v) => v.id === vault.id), loansWhere((l) => l.vaultID === vault.vaultID)]);
  loans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/broker" className="text-xs text-ink/60 hover:underline">← My vaults</Link>
          <h1 className="text-2xl font-semibold">{view.name}</h1>
          <p className="text-sm text-ink/60">{view.description || "—"} · <Address value={view.vaultID} label="Vault" /></p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Liquidity available" value={fmtUSD(view.assetsAvailable)} hint={`${fmtUSD(view.assetsTotal)} deposited in total`} />
        <Stat label="Active loans" value={view.loans.active} hint={`${view.loans.repaid} repaid · ${view.loans.defaulted} defaulted`} />
        <Stat label="Price per share" value={view.pricePerShare.toFixed(6)} hint="drops when a default exceeds the cover" />
        <Stat label="Ticket" value="1 000 USD" hint="cover 700 · protection 400" />
      </div>

      <h2 className="text-lg font-semibold">Loans from this vault</h2>
      {loans.length === 0 && (
        <Card>
          <p className="text-sm text-ink/70">No loan yet. Borrowers see this vault on the marketplace as soon as it holds 1 000 USD.</p>
        </Card>
      )}
      {loans.map((loan) => {
        const defaultable = loan.status === "active";
        const claimable = loan.status === "defaulted" && !!loan.guarantee && loan.guarantee.locked > 0;
        const closable = loan.status === "repaid" || loan.status === "defaulted";
        return (
          <LoanCard
            key={loan.id}
            loan={loan}
            show={["borrower", "seller"]}
            actions={
              <>
                <TxForm
                  inline
                  action={declareDefaultAction}
                  hidden={{ loanId: loan.id }}
                  submitLabel="Declare default"
                  variant="outline"
                  disabled={!defaultable}
                  disabledReason={!defaultable ? "Only an active loan can default." : loan.ledgerStatus === "defaultable" ? "Grace period elapsed — the ledger will accept." : "Before the grace period ends the ledger answers tecTOO_SOON."}
                />
                <TxForm
                  inline
                  action={claimInsuranceAction}
                  hidden={{ loanId: loan.id }}
                  submitLabel="Claim insurance"
                  variant="contrast"
                  disabled={!claimable}
                  disabledReason={claimable ? undefined : "Claimable after a default, while escrows are locked."}
                />
                <TxForm
                  inline
                  action={closeLoanAction}
                  hidden={{ loanId: loan.id }}
                  submitLabel="Close & recover cover"
                  variant="outline"
                  disabled={!closable}
                  disabledReason={closable ? undefined : "Once repaid or defaulted."}
                />
              </>
            }
          />
        );
      })}
    </>
  );
}

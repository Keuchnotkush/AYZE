import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountActivity } from "@/components/dashboard/account-activity";
import { Address } from "@/components/dashboard/address";
import { LoanCard } from "@/components/dashboard/loan-card";
import { RunServicing } from "@/components/dashboard/run-servicing";
import { Forbidden } from "@/components/dashboard/forbidden";
import { Card, Stat } from "@/components/dashboard/stat";
import { TxForm } from "@/components/dashboard/tx-form";
import { fmtXRP } from "@/lib/format";
import { claimInsuranceAction, closeLoanAction, declareDefaultAction } from "@/server/actions";
import { pageRole } from "@/server/auth/session";
import { findVault } from "@/server/registry";
import { listVaults, loansWhere, walletView } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function BrokerVaultPage({ params }: PageProps<"/broker/vaults/[id]">) {
  const gate = await pageRole("broker");
  if (gate.user === null) return <Forbidden message={gate.forbidden} />;
  const broker = gate.user;
  const { id } = await params;
  const vault = findVault(id);
  if (!vault || vault.brokerId !== broker.id) notFound();
  const [[view], loans, wallet] = await Promise.all([listVaults((v) => v.id === vault.id), loansWhere((l) => l.vaultID === vault.vaultID), walletView(broker)]);
  loans.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/broker" className="text-xs text-ink/60 hover:underline">← My vaults</Link>
          <h1 className="text-2xl font-semibold">{view.name}</h1>
          <p className="text-sm text-ink/60">
            {view.description || "—"} · <Address value={view.vaultID} label="Vault" />
            {view.loanBrokerID && <> · <Address value={view.loanBrokerID} label="LoanBroker" /></>}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Stat label="Wallet" value={fmtXRP(wallet.xrp)} />
          <AccountActivity address={wallet.address} label="Broker XRP" />
          {view.account && <AccountActivity address={view.account} label="Vault account XRP" />}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Liquidity available" value={fmtXRP(view.assetsAvailable)} hint={`${fmtXRP(view.assetsTotal)} deposited`} />
        <Stat label="Cover available" value={fmtXRP(view.coverAvailable)} hint={view.loanBrokerID ? `${fmtXRP(view.coverPosted)} posted · 700 XRP per open loan` : "no LoanBroker on this vault"} />
        <Stat label="Active loans" value={view.loans.active} hint={`${view.loans.repaid} repaid · ${view.loans.defaulted} defaulted`} />
        <Stat label="Price per share" value={view.pricePerShare.toFixed(6)} />
      </div>

      <Card title="Verified borrowers">
        {view.verifiedBorrowers.length === 0 ? (
          <p className="text-sm text-ink/70">None.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {view.verifiedBorrowers.map((b) => (
              <li key={b.id}>
                {b.company} <Address value={b.address} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Loans</h2>
        <RunServicing />
      </div>
      {loans.length === 0 && (
        <Card>
          <p className="text-sm text-ink/70">No loan yet.</p>
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
                  submitLabel="Close loan"
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

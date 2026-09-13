import Link from "next/link";
import { Vault } from "lucide-react";
import { AccountActivity } from "@/components/dashboard/account-activity";
import { EmptyState } from "@/components/dashboard/empty-state";
import { RunServicing } from "@/components/dashboard/run-servicing";
import { Forbidden } from "@/components/dashboard/forbidden";
import { Card, Stat } from "@/components/dashboard/stat";
import { TxForm } from "@/components/dashboard/tx-form";
import { fmtXRP } from "@/lib/format";
import { createVaultAction } from "@/server/actions";
import { pageRole } from "@/server/auth/session";
import { listVaults, walletView } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function BrokerPage() {
  const gate = await pageRole("broker");
  if (gate.user === null) return <Forbidden message={gate.forbidden} />;
  const broker = gate.user;
  const [vaults, wallet] = await Promise.all([listVaults((v) => v.brokerId === broker.id), walletView(broker)]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">My vaults</h1>
        <div className="flex flex-wrap items-end gap-3">
          <Stat label="Wallet" value={fmtXRP(wallet.xrp)} />
          <AccountActivity address={wallet.address} />
          <RunServicing />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          {vaults.length === 0 && (
            <EmptyState icon={Vault} title="No vault yet" hint="Create your first vault on the right. Post 700 XRP of first-loss capital for every loan you want the vault to allow at once." />
          )}
          {vaults.map((vault) => (
            <Link key={vault.id} href={`/broker/vaults/${vault.id}`} className="group rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olympic">
              <Card className="transition-colors group-hover:border-olympic">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold group-hover:text-olympic-deep">{vault.name}</h2>
                    <p className="text-sm text-ink/60">{vault.description || "—"}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Liquidity" value={fmtXRP(vault.assetsAvailable)} hint={`${fmtXRP(vault.assetsTotal)} total`} plain />
                    <Stat label="Cover available" value={fmtXRP(vault.coverAvailable)} hint={vault.loanBrokerID ? `${fmtXRP(vault.coverPosted)} posted` : "no LoanBroker"} plain />
                    <Stat label="Active loans" value={vault.loans.active} hint={`${vault.loans.repaid} repaid`} plain />
                    <Stat label="Defaulted" value={vault.loans.defaulted} plain />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <Card title="Create a vault">
          <TxForm
            action={createVaultAction}
            fields={[
              { name: "name", label: "Name", placeholder: "Working capital · Q4", required: true },
              { name: "description", label: "Description", placeholder: "Short-term financing for…" },
              { name: "firstLoss", label: "First-loss capital (XRP)", placeholder: "2100", required: true, type: "amount", hint: "700 XRP per open loan. Locked in the vault's LoanBroker." },
            ]}
            submitLabel="Create vault"
            pendingLabel="Creating vault, LoanBroker and cover…"
          />
        </Card>
      </div>
    </>
  );
}

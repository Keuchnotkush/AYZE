import Link from "next/link";
import { Card, Stat } from "@/components/dashboard/stat";
import { TxForm } from "@/components/dashboard/tx-form";
import { fmtUSD } from "@/lib/format";
import { createVaultAction } from "@/server/actions";
import { requireRole } from "@/server/auth/session";
import { listVaults, walletView } from "@/server/views";

export const dynamic = "force-dynamic";

export default async function BrokerPage() {
  const broker = await requireRole("broker");
  const [vaults, wallet] = await Promise.all([listVaults((v) => v.brokerId === broker.id), walletView(broker)]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">My vaults</h1>
        <span className="text-sm text-ink/60">Wallet {fmtUSD(wallet.usd)} — 700 USD of first-loss cover is drawn from it for every loan.</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          {vaults.length === 0 && (
            <Card>
              <p className="text-sm text-ink/70">No vault yet. Create one to start receiving deposits and loan requests.</p>
            </Card>
          )}
          {vaults.map((vault) => (
            <Link key={vault.id} href={`/broker/vaults/${vault.id}`} className="group rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olympic">
              <Card className="transition-colors group-hover:border-olympic">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold group-hover:text-olympic-deep">{vault.name}</h2>
                    <p className="text-sm text-ink/60">{vault.description || "—"}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <Stat label="Liquidity" value={fmtUSD(vault.assetsAvailable)} hint={`${fmtUSD(vault.assetsTotal)} total`} className="border-0 px-0 py-0" />
                    <Stat label="Active loans" value={vault.loans.active} hint={`${vault.loans.repaid} repaid`} className="border-0 px-0 py-0" />
                    <Stat label="Defaulted" value={vault.loans.defaulted} className="border-0 px-0 py-0" />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>

        <Card title="Create a vault">
          <p className="text-sm text-ink/70">
            An open-ended XLS-65 vault you own. Lenders deposit USD, borrowers draw 1 000 USD tickets, you post 70 % first-loss on each loan.
          </p>
          <TxForm
            action={createVaultAction}
            fields={[
              { name: "name", label: "Name", placeholder: "Working capital · Q4", required: true },
              { name: "description", label: "Description", placeholder: "Short-term financing for…" },
            ]}
            submitLabel="Create vault"
          />
        </Card>
      </div>
    </>
  );
}

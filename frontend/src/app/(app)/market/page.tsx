import { Store } from "lucide-react";
import { AccountActivity } from "@/components/dashboard/account-activity";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Address } from "@/components/dashboard/address";
import { Forbidden } from "@/components/dashboard/forbidden";
import { Badge, Card, Stat } from "@/components/dashboard/stat";
import { ExtensionTxForm } from "@/components/dashboard/extension-tx-form";
import { TxForm } from "@/components/dashboard/tx-form";
import { fmtXRP } from "@/lib/format";
import {
  beVerifiedAction,
  borrowAction,
  depositAction,
  prepareDepositAction,
  prepareWithdrawAction,
  recordDepositAction,
  recordWithdrawAction,
  withdrawAction,
} from "@/server/actions";
import { pageRole } from "@/server/auth/session";
import { hasVaultAccess } from "@/server/credentials";
import { TERMS } from "@/server/economics";
import { readRegistry } from "@/server/registry";
import { lenderPosition, listVaults, walletView, type PositionView } from "@/server/views";

export const dynamic = "force-dynamic";

/** Marketplace: lenders deposit into vaults, borrowers draw tickets from them. */
export default async function MarketPage() {
  const gate = await pageRole("lender", "borrower");
  if (gate.user === null) return <Forbidden message={gate.forbidden} />;
  const user = gate.user;
  const [vaults, wallet] = await Promise.all([listVaults(), walletView(user)]);
  vaults.sort((a, b) => b.assetsAvailable - a.assetsAvailable);

  const positions: Record<string, PositionView> = {};
  const verified: Record<string, boolean> = {};
  const registryVaults = readRegistry().vaults;
  await Promise.all(
    vaults.map(async (v) => {
      const rv = registryVaults.find((r) => r.id === v.id);
      if (!rv) return;
      if (user.role === "lender") positions[v.id] = await lenderPosition(user, rv);
      else verified[v.id] = await hasVaultAccess(user, rv);
    }),
  );
  const isLender = user.role === "lender";
  const verifiedCount = Object.values(verified).filter(Boolean).length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Marketplace</h1>
        <div className="flex flex-wrap gap-3">
          <Stat label="Wallet" value={fmtXRP(wallet.xrp)} hint={isLender ? undefined : `verified on ${verifiedCount}/${vaults.length} vaults`} />
          <AccountActivity address={wallet.address} />
        </div>
      </div>

      {vaults.length === 0 && (
        <EmptyState
          icon={Store}
          title="No vault on the marketplace yet"
          hint={isLender ? "Brokers haven't opened a vault. Check back soon." : "Brokers haven't opened a vault. Once one is listed you'll get verified for it, then borrow 1 000 XRP."}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {vaults.map((vault) => (
          <Card key={vault.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold">{vault.name}</h2>
                <p className="text-sm text-ink/60">{vault.description || "—"}</p>
                <p className="text-xs text-ink/60">Broker {vault.broker.company} <Address value={vault.broker.address} /></p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {!isLender && verified[vault.id] && <Badge tone="accent">Verified</Badge>}
                {vault.canBorrow ? <Badge tone="good">open</Badge> : <Badge tone="neutral">needs liquidity</Badge>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Available" value={fmtXRP(vault.assetsAvailable)} hint={`${fmtXRP(vault.assetsTotal)} total`} plain />
              <Stat label="Loans" value={vault.loans.active} hint={`${vault.loans.repaid} repaid · ${vault.loans.defaulted} defaulted · cover ${fmtXRP(vault.coverAvailable)}`} plain />
              {isLender ? (
                <Stat label="My position" value={fmtXRP(positions[vault.id]?.value ?? 0)} hint={`${(positions[vault.id]?.shares ?? 0).toLocaleString()} shares`} plain />
              ) : (
                <Stat label="Share price" value={vault.pricePerShare.toFixed(4)} plain />
              )}
            </div>

            {isLender && user.provider ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <ExtensionTxForm
                  inline
                  provider={user.provider}
                  prepare={prepareDepositAction}
                  record={recordDepositAction}
                  hidden={{ vaultId: vault.id }}
                  fields={[{ name: "amount", label: "Deposit (XRP)", placeholder: "1000", required: true, type: "amount" }]}
                  submitLabel="Deposit"
                />
                <ExtensionTxForm
                  inline
                  provider={user.provider}
                  prepare={prepareWithdrawAction}
                  record={recordWithdrawAction}
                  hidden={{ vaultId: vault.id }}
                  fields={[{ name: "amount", label: "Withdraw (XRP, empty = all)", placeholder: "Redeem all", type: "amount" }]}
                  submitLabel="Withdraw"
                  variant="outline"
                  disabled={!positions[vault.id] || positions[vault.id].shares === 0}
                />
              </div>
            ) : isLender ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <TxForm
                  inline
                  action={depositAction}
                  hidden={{ vaultId: vault.id }}
                  fields={[{ name: "amount", label: "Deposit (XRP)", placeholder: "1000", required: true, type: "amount" }]}
                  submitLabel="Deposit"
                />
                <TxForm
                  inline
                  action={withdrawAction}
                  hidden={{ vaultId: vault.id }}
                  fields={[{ name: "amount", label: "Withdraw (XRP, empty = all)", placeholder: "Redeem all", type: "amount" }]}
                  submitLabel="Withdraw"
                  variant="outline"
                  disabled={!positions[vault.id] || positions[vault.id].shares === 0}
                />
              </div>
            ) : (
              <>
                {!verified[vault.id] && (
                  <TxForm inline action={beVerifiedAction} hidden={{ vaultId: vault.id }} submitLabel="Be verified" pendingLabel="Issuing credentials…" variant="contrast" />
                )}
                <TxForm
                  inline
                  action={borrowAction}
                  hidden={{ vaultId: vault.id }}
                  fields={[
                    { name: "paymentTotal", label: "Instalments", defaultValue: "3", type: "number", hint: `${TERMS.minInstalments}–${TERMS.maxInstalments}` },
                    { name: "paymentInterval", label: "Interval (s)", defaultValue: "120", type: "number", hint: `≥ ${TERMS.minInterval}s` },
                  ]}
                  submitLabel="Borrow 1 000 XRP"
                  disabled={!vault.canBorrow || !verified[vault.id]}
                  disabledReason={!verified[vault.id] ? "Verification required." : vault.canBorrow ? undefined : "Less than 1 000 XRP available."}
                  className="grid gap-3 sm:grid-cols-2 [&>button]:sm:col-span-2 [&>div[role=status]]:sm:col-span-2"
                />
              </>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

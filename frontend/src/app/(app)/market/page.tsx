import { Address } from "@/components/dashboard/address";
import { Badge, Card, Stat } from "@/components/dashboard/stat";
import { TxForm } from "@/components/dashboard/tx-form";
import { fmtUSD } from "@/lib/format";
import { borrowAction, depositAction, withdrawAction } from "@/server/actions";
import { currentUser } from "@/server/auth/session";
import { TERMS } from "@/server/economics";
import { AyzeError } from "@/server/errors";
import { readRegistry } from "@/server/registry";
import { lenderPosition, listVaults, walletView, type PositionView } from "@/server/views";

export const dynamic = "force-dynamic";

/** Marketplace: lenders deposit into vaults, borrowers draw tickets from them. */
export default async function MarketPage() {
  const user = await currentUser();
  if (!user) throw new AyzeError("AYZE_UNAUTHENTICATED", "Log in to continue.");
  if (user.role !== "lender" && user.role !== "borrower") {
    throw new AyzeError("AYZE_FORBIDDEN_ROLE", `The marketplace is for lenders and borrowers (you are ${user.role}).`);
  }
  const [vaults, wallet] = await Promise.all([listVaults(), walletView(user)]);
  vaults.sort((a, b) => b.assetsAvailable - a.assetsAvailable);

  const positions: Record<string, PositionView> = {};
  if (user.role === "lender") {
    const registryVaults = readRegistry().vaults;
    await Promise.all(
      vaults.map(async (v) => {
        const rv = registryVaults.find((r) => r.id === v.id);
        if (rv) positions[v.id] = await lenderPosition(user, rv);
      }),
    );
  }
  const isLender = user.role === "lender";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Marketplace</h1>
          <p className="text-sm text-ink/60">
            {isLender
              ? "Deposit into a broker's vault and earn 20 % of the 6 % interest on every loan it funds."
              : "Draw a 1 000 USD ticket from any vault with liquidity. 6 % flat interest + 0.5 % AYZE fee."}
          </p>
        </div>
        <Stat label="Wallet" value={fmtUSD(wallet.usd)} hint={user.role === "borrower" ? (user.credential ? "KYC credential on ledger ✓" : "no KYC credential") : "available"} />
      </div>

      {vaults.length === 0 && (
        <Card>
          <p className="text-sm text-ink/70">No vault has been opened yet. A broker needs to create one first.</p>
        </Card>
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
              {vault.canBorrow ? <Badge tone="good">open</Badge> : <Badge tone="neutral">needs liquidity</Badge>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Available" value={fmtUSD(vault.assetsAvailable)} hint={`${fmtUSD(vault.assetsTotal)} total`} className="border-0 px-0 py-0" />
              <Stat label="Loans" value={vault.loans.active} hint={`${vault.loans.repaid} repaid · ${vault.loans.defaulted} defaulted`} className="border-0 px-0 py-0" />
              {isLender ? (
                <Stat label="My position" value={fmtUSD(positions[vault.id]?.value ?? 0)} hint={`${(positions[vault.id]?.shares ?? 0).toLocaleString()} shares`} className="border-0 px-0 py-0" />
              ) : (
                <Stat label="Share price" value={vault.pricePerShare.toFixed(4)} hint="lenders' NAV" className="border-0 px-0 py-0" />
              )}
            </div>

            {isLender ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <TxForm
                  inline
                  action={depositAction}
                  hidden={{ vaultId: vault.id }}
                  fields={[{ name: "amount", label: "Deposit (USD)", placeholder: "1000", required: true }]}
                  submitLabel="Deposit"
                />
                <TxForm
                  inline
                  action={withdrawAction}
                  hidden={{ vaultId: vault.id }}
                  fields={[{ name: "amount", label: "Withdraw (USD, empty = all)", placeholder: "Redeem all" }]}
                  submitLabel="Withdraw"
                  variant="outline"
                  disabled={!positions[vault.id] || positions[vault.id].shares === 0}
                />
              </div>
            ) : (
              <TxForm
                inline
                action={borrowAction}
                hidden={{ vaultId: vault.id }}
                fields={[
                  { name: "paymentTotal", label: "Instalments", defaultValue: "3", type: "number", hint: `${TERMS.minInstalments}–${TERMS.maxInstalments}` },
                  { name: "paymentInterval", label: "Interval (s)", defaultValue: "120", type: "number", hint: `≥ ${TERMS.minInterval}s` },
                  { name: "gracePeriod", label: "Grace (s)", defaultValue: "60", type: "number", hint: "60s – interval" },
                ]}
                submitLabel="Borrow 1 000 USD"
                disabled={!vault.canBorrow}
                disabledReason={vault.canBorrow ? undefined : "This vault holds less than one ticket."}
                className="grid gap-3 sm:grid-cols-3 [&>button]:sm:col-span-3 [&>div[role=status]]:sm:col-span-3"
              />
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

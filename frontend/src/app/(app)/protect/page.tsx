import { ShieldCheck, ShieldOff } from "lucide-react";
import { AccountActivity } from "@/components/dashboard/account-activity";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LoanCard } from "@/components/dashboard/loan-card";
import { Forbidden } from "@/components/dashboard/forbidden";
import { Stat } from "@/components/dashboard/stat";
import { ExtensionTxForm } from "@/components/dashboard/extension-tx-form";
import { TxForm } from "@/components/dashboard/tx-form";
import { fmtXRP } from "@/lib/format";
import {
  acceptAccreditationAction,
  guaranteeAction,
  prepareAcceptAccreditationAction,
  prepareGuaranteeAction,
  recordAcceptAccreditationAction,
  recordGuaranteeAction,
} from "@/server/actions";
import { pageRole } from "@/server/auth/session";
import { sellerAccreditation } from "@/server/credentials";
import type { CredentialStatus } from "@/server/ledger";
import { readRegistry } from "@/server/registry";
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

  /* Accreditation per vault (ledger read): only accredited sellers may guarantee a vault's loans. */
  const vaults = readRegistry().vaults;
  const accreditation: Record<string, CredentialStatus> = {};
  await Promise.all(
    [...new Set(open.map((l) => l.vault.id))].map(async (vaultId) => {
      const vault = vaults.find((v) => v.id === vaultId);
      accreditation[vaultId] = vault ? await sellerAccreditation(seller, vault) : "none";
    }),
  );
  const accreditedCount = Object.values(accreditation).filter((s) => s === "accepted").length;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold">Protection</h1>
        <div className="flex flex-wrap gap-3">
          <Stat label="Wallet" value={fmtXRP(wallet.xrp)} />
          <Stat label="Locked" value={fmtXRP(locked)} hint={`${mine.length} loans protected`} />
          <Stat label="Accredited" value={`${accreditedCount} / ${Object.keys(accreditation).length}`} hint="vaults with open loans" />
          <AccountActivity address={wallet.address} />
        </div>
      </div>

      <h2 className="text-lg font-semibold">Loans seeking protection</h2>
      {open.length === 0 && (
        <EmptyState icon={ShieldOff} title="No loan is seeking protection right now" hint="Every active loan already has a protection seller, or none has been drawn yet. New loans appear here as soon as a borrower draws one." />
      )}
      {open.map((loan) => {
        const overdue = loan.ledgerStatus === "defaultable" || loan.ledgerStatus === "late";
        const label = `Guarantee (${fmtXRP((loan.principal - (loan.paidCount * loan.principal) / loan.paymentTotal) * 0.4)} locked, ${fmtXRP(loan.interestTotal * 0.5)} premium)`;
        const status = accreditation[loan.vault.id] ?? "none";
        const accreditationHint =
          status === "none"
            ? `Not accredited by ${loan.vault.name}'s broker. Share your address (${wallet.address}) with them to be accredited.`
            : status === "issued"
              ? `${loan.vault.name}'s broker accredited you; accept the credential to guarantee its loans.`
              : undefined;
        return (
          <LoanCard
            key={loan.id}
            loan={loan}
            show={["vault", "broker", "borrower"]}
            actions={
              status !== "accepted" ? (
                status === "issued" ? (
                  seller.provider ? (
                    <ExtensionTxForm inline provider={seller.provider} prepare={prepareAcceptAccreditationAction} record={recordAcceptAccreditationAction} hidden={{ vaultId: loan.vault.id }} submitLabel="Accept accreditation" variant="contrast" />
                  ) : (
                    <TxForm inline action={acceptAccreditationAction} hidden={{ vaultId: loan.vault.id }} submitLabel="Accept accreditation" pendingLabel="Accepting credential…" variant="contrast" />
                  )
                ) : (
                  <TxForm inline action={guaranteeAction} hidden={{ loanId: loan.id }} submitLabel={label} disabled disabledReason={accreditationHint} />
                )
              ) : seller.provider ? (
                <ExtensionTxForm
                  inline
                  provider={seller.provider}
                  prepare={prepareGuaranteeAction}
                  record={recordGuaranteeAction}
                  hidden={{ loanId: loan.id }}
                  submitLabel={label}
                  disabled={overdue}
                  disabledReason={overdue ? "This loan is already overdue." : undefined}
                />
              ) : (
                <TxForm
                  inline
                  action={guaranteeAction}
                  hidden={{ loanId: loan.id }}
                  submitLabel={label}
                  disabled={overdue}
                  disabledReason={overdue ? "This loan is already overdue." : undefined}
                />
              )
            }
          >
            {status === "issued" && <p className="text-xs text-amber-700">{accreditationHint}</p>}
          </LoanCard>
        );
      })}

      <h2 className="text-lg font-semibold">My guarantees</h2>
      {mine.length === 0 && (
        <EmptyState icon={ShieldCheck} title="No guarantee yet" hint="Guarantee a loan above: you lock 40 % of each remaining instalment in escrow and earn 50 % of the loan's interest as it is paid." />
      )}
      {mine.map((loan) => (
        <LoanCard key={loan.id} loan={loan} show={["vault", "broker", "borrower"]} />
      ))}
    </>
  );
}

import "server-only";
import { VaultWithdrawalPolicy, type LoanBrokerCoverDeposit, type LoanBrokerSet, type VaultCreate, type VaultDeposit, type VaultWithdraw } from "xrpl";
import { walletOf } from "./accounts";
import { dropsToXrp, toXRPL, type Drops } from "./amounts";
import { COVER_RATE_LIQUIDATION, COVER_RATE_MINIMUM } from "./economics";
import { AyzeError } from "./errors";
import { createdIndex, getShareBalance, getSpendableBalance, getVaultState, ledgerEntry } from "./ledger";
import { newId, updateRegistry, type User, type Vault } from "./registry";
import { submit } from "./xrpl";

const ASSETS_MAXIMUM = "0"; // no cap
/** XLS-65 asset descriptor for native XRP. `Scale` must be omitted: XRP shares are implicitly 6 decimals (drops). */
const XRP_ASSET = { currency: "XRP" } as const;
/** Ledger objects a broker creates when opening a vault: Vault, its share MPToken holding, LoanBroker. */
const VAULT_OBJECTS = 3;

/**
 * Broker opens a public open-ended vault and its LoanBroker in one go:
 * VaultCreate → LoanBrokerSet → LoanBrokerCoverDeposit(firstLoss). Stops at the
 * first ledger rejection (AyzeError XRPL_<code>). `firstLoss` is drops, > 0.
 */
export async function createVault(broker: User, name: string, description: string, firstLoss: Drops): Promise<{ vault: Vault; hashes: string[] }> {
  if (firstLoss <= 0n) throw new AyzeError("AYZE_INVALID_INPUT", "First-loss capital must be positive.");
  const wallet = walletOf(broker);
  const balance = await getSpendableBalance(wallet.address, VAULT_OBJECTS);
  if (balance < firstLoss) {
    throw new AyzeError("AYZE_BROKER_COVER_INSUFFICIENT", `Wallet can spend ${dropsToXrp(balance)} XRP (after reserve); ${dropsToXrp(firstLoss)} XRP of first-loss capital requested.`);
  }

  // 1. Vault
  const tx: VaultCreate = {
    TransactionType: "VaultCreate",
    Account: wallet.address,
    Asset: XRP_ASSET,
    AssetsMaximum: ASSETS_MAXIMUM,
    WithdrawalPolicy: VaultWithdrawalPolicy.vaultStrategyFirstComeFirstServe,
  };
  const created = await submit(tx, wallet);
  const vaultID = createdIndex(created.meta, "Vault");
  const node = await ledgerEntry(vaultID);

  // 2. LoanBroker on that vault
  const brokerSet: LoanBrokerSet = {
    TransactionType: "LoanBrokerSet",
    Account: wallet.address,
    VaultID: vaultID,
    ManagementFeeRate: 0,
    DebtMaximum: "0", // unlimited
    CoverRateMinimum: COVER_RATE_MINIMUM,
    CoverRateLiquidation: COVER_RATE_LIQUIDATION,
  };
  const set = await submit(brokerSet, wallet);
  const loanBrokerID = createdIndex(set.meta, "LoanBroker");

  // 3. First-loss capital
  const coverTx: LoanBrokerCoverDeposit = {
    TransactionType: "LoanBrokerCoverDeposit",
    Account: wallet.address,
    LoanBrokerID: loanBrokerID,
    Amount: toXRPL(firstLoss),
  };
  const posted = await submit(coverTx, wallet);

  const vault: Vault = {
    id: newId(),
    vaultID,
    shareMPTID: String(node?.ShareMPTID ?? ""),
    brokerId: broker.id,
    name: name.trim(),
    description: description.trim(),
    loanBrokerID,
    firstLoss: firstLoss.toString(),
    createdAt: new Date().toISOString(),
  };
  await updateRegistry((r) => r.vaults.push(vault));
  return { vault, hashes: [created.hash, set.hash, posted.hash] };
}

export async function deposit(lender: User, vault: Vault, amount: Drops): Promise<string> {
  const wallet = walletOf(lender);
  const balance = await getSpendableBalance(wallet.address, 1); // the share MPToken holding
  if (balance < amount) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", `Wallet can spend ${dropsToXrp(balance)} XRP (after reserve).`);
  const tx: VaultDeposit = {
    TransactionType: "VaultDeposit",
    Account: wallet.address,
    VaultID: vault.vaultID,
    Amount: toXRPL(amount),
  };
  const { hash } = await submit(tx, wallet);
  await updateRegistry((r) => {
    if (!r.deposits.some((d) => d.vaultID === vault.vaultID && d.lenderId === lender.id)) {
      r.deposits.push({ vaultID: vault.vaultID, lenderId: lender.id });
    }
  });
  return hash;
}

/** `amount` in drops, or null to redeem every share at the current price. */
export async function withdraw(lender: User, vault: Vault, amount: Drops | null): Promise<string> {
  const wallet = walletOf(lender);
  const state = await getVaultState(vault.vaultID);
  if (!state) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found on the ledger.");
  let Amount: VaultWithdraw["Amount"];
  if (amount) {
    Amount = toXRPL(amount);
  } else {
    const shares = await getShareBalance(wallet.address, state.shareMPTID);
    if (shares === 0n) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", "No shares to redeem in this vault.");
    Amount = { mpt_issuance_id: state.shareMPTID, value: shares.toString() };
  }
  const tx: VaultWithdraw = {
    TransactionType: "VaultWithdraw",
    Account: wallet.address,
    VaultID: vault.vaultID,
    Amount,
    Destination: wallet.address,
  };
  const { hash } = await submit(tx, wallet);
  return hash;
}

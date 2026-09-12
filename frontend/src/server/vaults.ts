import "server-only";
import { VaultWithdrawalPolicy, type VaultCreate, type VaultDeposit, type VaultWithdraw } from "xrpl";
import { walletOf } from "./accounts";
import { toXRPL, type Micro } from "./amounts";
import { AyzeError } from "./errors";
import { createdIndex, getShareBalance, getUSDBalance, getVaultState, ledgerEntry } from "./ledger";
import { ensurePlatform, usdAsset } from "./platform";
import { newId, updateRegistry, type User, type Vault } from "./registry";
import { submit } from "./xrpl";

const ASSETS_MAXIMUM = "0"; // no cap
const SHARE_SCALE = 6;

/** Broker opens a public open-ended vault; it becomes a marketplace listing. */
export async function createVault(broker: User, name: string, description: string): Promise<{ vault: Vault; hash: string }> {
  const platform = await ensurePlatform();
  const wallet = walletOf(broker);
  const tx: VaultCreate = {
    TransactionType: "VaultCreate",
    Account: wallet.address,
    Asset: usdAsset(platform),
    AssetsMaximum: ASSETS_MAXIMUM,
    WithdrawalPolicy: VaultWithdrawalPolicy.vaultStrategyFirstComeFirstServe,
    Scale: SHARE_SCALE,
  };
  const { hash, meta } = await submit(tx, wallet);
  const vaultID = createdIndex(meta, "Vault");
  const node = await ledgerEntry(vaultID);
  const vault: Vault = {
    id: newId(),
    vaultID,
    shareMPTID: String(node?.ShareMPTID ?? ""),
    brokerId: broker.id,
    name: name.trim(),
    description: description.trim(),
    createdAt: new Date().toISOString(),
  };
  await updateRegistry((r) => r.vaults.push(vault));
  return { vault, hash };
}

export async function deposit(lender: User, vault: Vault, amount: Micro): Promise<string> {
  const platform = await ensurePlatform();
  const wallet = walletOf(lender);
  const balance = await getUSDBalance(wallet.address, platform.issuer.address);
  if (balance < amount) throw new AyzeError("AYZE_INSUFFICIENT_FUNDS", `Wallet holds ${toXRPL(balance)} USD.`);
  const tx: VaultDeposit = {
    TransactionType: "VaultDeposit",
    Account: wallet.address,
    VaultID: vault.vaultID,
    Amount: { ...usdAsset(platform), value: toXRPL(amount) },
  };
  const { hash } = await submit(tx, wallet);
  await updateRegistry((r) => {
    if (!r.deposits.some((d) => d.vaultID === vault.vaultID && d.lenderId === lender.id)) {
      r.deposits.push({ vaultID: vault.vaultID, lenderId: lender.id });
    }
  });
  return hash;
}

/** `amount` in USD, or null to redeem every share at the current price. */
export async function withdraw(lender: User, vault: Vault, amount: Micro | null): Promise<string> {
  const platform = await ensurePlatform();
  const wallet = walletOf(lender);
  const state = await getVaultState(vault.vaultID);
  if (!state) throw new AyzeError("AYZE_NOT_FOUND", "Vault not found on the ledger.");
  let Amount: VaultWithdraw["Amount"];
  if (amount) {
    Amount = { ...usdAsset(platform), value: toXRPL(amount) };
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

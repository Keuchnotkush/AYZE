import { Client } from "xrpl";
import fs from "fs";

const client = new Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const vaultData = JSON.parse(
    fs.readFileSync("vault.json", "utf8")
);

const accounts = JSON.parse(
    fs.readFileSync("accounts.json", "utf8")
);

async function getLenderShareBalance(): Promise<string> {
    try {
        const response: any =
            await client.request({
                command: "ledger_entry",
                ledger_index: "validated",
                mptoken: {
                    mpt_issuance_id:
                        vaultData.shareMPTID,
                    account:
                        accounts.lender.address
                }
            } as any);

        return (
            response.result.node
                ?.MPTAmount ?? "0"
        );

    } catch (err: any) {
        if (
            err?.data?.error ===
            "entryNotFound"
        ) {
            return "0";
        }

        throw err;
    }
}

async function main() {
    await client.connect();

    try {
        const response: any =
            await client.request({
                command: "vault_info",
                vault_id:
                    vaultData.vaultID,
                ledger_index:
                    "validated"
            });

        const vault =
            response.result.vault;

        const rawShares =
            Number(
                response.result.vault
                    .shares
                    .OutstandingAmount
                    ?? 0
            );

        const scale =
            Number(
                vault.Scale ??
                vaultData.scale ??
                0
            );

        const humanShares =
            rawShares /
            Math.pow(10, scale);

        const totalAssets =
            Number(
                vault.AssetsTotal ?? 0
            );

        const pps =
            humanShares > 0
                ? totalAssets / humanShares
                : 0;

        const lenderShares =
            await getLenderShareBalance();

        console.log(
            "\n=============================="
        );
        console.log(
            "      AYZE OPEN VAULT"
        );
        console.log(
            "=============================="
        );

        console.log(
            "Track:",
            "1 - Open-ended"
        );

        console.log(
            "Vault ID:",
            vaultData.vaultID
        );

        console.log(
            "Vault account:",
            vault.Account
        );

        console.log(
            "\n=== LIQUIDITY ==="
        );

        console.log(
            "Total assets:",
            vault.AssetsTotal
        );

        console.log(
            "Available assets:",
            vault.AssetsAvailable
        );

        console.log(
            "\n=== SHARES / YIELD ==="
        );

        console.log(
            "Share MPT:",
            vault.ShareMPTID
        );

        console.log(
            "Outstanding shares (raw):",
            rawShares
        );

        console.log(
            "Outstanding shares:",
            humanShares
        );

        console.log(
            "PPS:",
            pps
        );

        console.log(
            "Lender share balance (raw):",
            lenderShares
        );

        console.log(
            "\nVault owner:",
            vault.Owner
        );

        console.log(
            "AYZE address:",
            accounts.ayze.address
        );

        console.log(
            "\nTrack 1 has NO SubscriptionDate or RedemptionDate."
        );

    } finally {
        if (client.isConnected()) {
            await client.disconnect();
        }
    }
}

main().catch((err) => {
    console.error(
        "\nERROR:",
        err.message
    );
    process.exit(1);
});

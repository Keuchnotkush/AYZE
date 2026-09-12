import {
    Client,
    Wallet,
    type LoanBrokerSet
} from "xrpl";
import fs from "fs";

const client = new Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const accounts = JSON.parse(
    fs.readFileSync("accounts.json", "utf8")
);

const vault = JSON.parse(
    fs.readFileSync("vault.json", "utf8")
);

async function main() {
    await client.connect();

    try {
        const ayze = Wallet.fromSeed(
            accounts.ayze.seed
        );

        console.log("\n==============================");
        console.log("      AYZE LOAN BROKER");
        console.log("==============================");

        console.log("Owner:", ayze.address);
        console.log("Vault:", vault.vaultID);

        // ============================================
        // CHECK VAULT
        // ============================================

        const vaultCheck: any = await client.request({
            command: "ledger_entry",
            index: vault.vaultID,
            ledger_index: "validated"
        });

        const vaultNode = vaultCheck.result.node;

        console.log("\n=== VAULT CHECK ===");
        console.log("Vault ID:", vault.vaultID);
        console.log("Vault Owner:", vaultNode.Owner);
        console.log("AYZE address:", ayze.address);
        console.log(
            "Same owner:",
            vaultNode.Owner === ayze.address
        );

        console.log("AssetsTotal:", vaultNode.AssetsTotal ?? "0");
        console.log(
            "AssetsAvailable:",
            vaultNode.AssetsAvailable ?? "0"
        );

        if (vaultNode.Owner !== ayze.address) {
            throw new Error(
                "AYZE is not the owner of this Vault."
            );
        }


        // ============================================
        // CHECK AYZE OBJECTS
        // ============================================

        const objects: any = await client.request({
            command: "account_objects",
            account: ayze.address,
            ledger_index: "validated"
        });

        const loanBrokers = objects.result.account_objects.filter(
            (obj: any) =>
                obj.LedgerEntryType === "LoanBroker"
        );

        console.log("\n=== AYZE LOAN BROKERS ===");

        if (loanBrokers.length === 0) {
            console.log("No LoanBroker found.");
        }

        for (const lb of loanBrokers) {
            console.log(
                JSON.stringify(lb, null, 2)
            );
        }

        console.log(
            "\nLoanBroker count:",
            loanBrokers.length
        );

        const sameVault = loanBrokers.filter(
            (lb: any) =>
                lb.VaultID === vault.vaultID
        );

        console.log(
            "LoanBroker(s) using current Vault:",
            sameVault.length
        );

        // ============================================
        // CREATE MINIMAL LOAN BROKER
        // ============================================

        const tx: LoanBrokerSet = {
            TransactionType: "LoanBrokerSet",

            Account: ayze.address,

            VaultID: vault.vaultID,

            // AYZE receives 2% of loan interest
            ManagementFeeRate: 2000,

            // 0 = no protocol debt ceiling
            DebtMaximum: "0",

            // First-loss capital must represent
            // at least 90% of DebtTotal
            CoverRateMinimum: 90000,

            // On default, up to ~66.667% of
            // required cover can absorb losses
            CoverRateLiquidation: 66667
        };

        console.log("\n=== TRANSACTION ===");
        console.log(
            JSON.stringify(tx, null, 2)
        );

        console.log("\nCreating LoanBroker...");

        const result: any =
            await client.submitAndWait(
                tx,
                {
                    wallet: ayze,
                    autofill: true
                }
            );

        const meta: any =
            result.result.meta;

        if (typeof meta !== "object") {
            throw new Error(
                "Transaction metadata missing."
            );
        }

        console.log(
            "LoanBrokerSet:",
            meta.TransactionResult
        );

        if (
            meta.TransactionResult !==
            "tesSUCCESS"
        ) {
            throw new Error(
                `LoanBrokerSet failed: ${meta.TransactionResult}`
            );
        }

        // ============================================
        // FIND CREATED LOAN BROKER
        // ============================================

        const node =
            meta.AffectedNodes.find(
                (n: any) =>
                    n.CreatedNode?.LedgerEntryType ===
                    "LoanBroker"
            );

        if (!node?.CreatedNode) {
            throw new Error(
                "LoanBroker ledger object not found."
            );
        }

        const loanBrokerID =
            node.CreatedNode.LedgerIndex;

        // ============================================
        // READ ON-CHAIN
        // ============================================

        const response: any =
            await client.request({
                command: "ledger_entry",
                index: loanBrokerID,
                ledger_index: "validated"
            });

        const loanBroker =
            response.result.node;

        console.log("\n==============================");
        console.log("    LOAN BROKER CREATED");
        console.log("==============================");

        console.log(
            "LoanBroker ID:",
            loanBrokerID
        );

        console.log(
            "Owner:",
            loanBroker.Owner
        );

        console.log(
            "Pseudo-account:",
            loanBroker.Account
        );

        console.log(
            "Vault ID:",
            loanBroker.VaultID
        );

        console.log(
            "ManagementFeeRate:",
            loanBroker.ManagementFeeRate,
            "= 2%"
        );

        console.log(
            "CoverRateMinimum:",
            loanBroker.CoverRateMinimum
        );

        console.log(
            "CoverRateLiquidation:",
            loanBroker.CoverRateLiquidation
        );

        console.log(
            "DebtMaximum:",
            loanBroker.DebtMaximum ?? "0"
        );

        console.log(
            "CoverAvailable:",
            loanBroker.CoverAvailable ?? "0"
        );

        console.log(
            "DebtTotal:",
            loanBroker.DebtTotal ?? "0"
        );

        // ============================================
        // SAVE
        // ============================================

        const brokerData = {
            loanBrokerID,

            pseudoAccount:
                loanBroker.Account,

            owner:
                loanBroker.Owner,

            vaultID:
                loanBroker.VaultID,

            managementFeeRate:
                Number(
                    loanBroker.ManagementFeeRate ?? 0
                ),

            coverRateMinimum:
                Number(
                    loanBroker.CoverRateMinimum ?? 0
                ),

            coverRateLiquidation:
                Number(
                    loanBroker.CoverRateLiquidation ?? 0
                ),

            debtMaximum:
                loanBroker.DebtMaximum ?? "0"
        };

        fs.writeFileSync(
            "broker.json",
            JSON.stringify(
                brokerData,
                null,
                2
            )
        );

        console.log("\nbroker.json saved");
    }

    finally {
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
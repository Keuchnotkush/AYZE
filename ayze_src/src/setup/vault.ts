import {
    Client,
    Wallet,
    VaultWithdrawalPolicy
} from "xrpl";

import fs from "fs";


// ============================================
// CONFIG
// ============================================

const client = new Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const accounts = JSON.parse(
    fs.readFileSync("state/accounts.json", "utf8")
);


// ============================================
// MAIN
// ============================================

async function main() {

    await client.connect();

    try {

        // ============================================
        // AYZE = PROTOCOL / VAULT MANAGER
        // ============================================

        const ayze =
            Wallet.fromSeed(
                accounts.ayze.seed
            );

        const issuer =
            accounts.issuer.address;


        console.log(
            "\n=============================="
        );

        console.log(
            "        AYZE VAULT"
        );

        console.log(
            "=============================="
        );

        console.log(
            "Manager:",
            ayze.address
        );

        console.log(
            "Asset: USD"
        );

        console.log(
            "Issuer:",
            issuer
        );

        console.log(
            "Max liquidity: 100000 USD"
        );


        // ============================================
        // CREATE VAULT
        // ============================================

        const tx: any = {

            TransactionType:
                "VaultCreate",

            // AYZE manages the Vault
            Account:
                ayze.address,

            // Asset deposited by lenders
            Asset: {
                currency:
                    "USD",

                issuer
            },

            // Maximum liquidity
            AssetsMaximum:
                "100000",

            // First Come First Serve withdrawals
            WithdrawalPolicy:
                VaultWithdrawalPolicy
                    .vaultStrategyFirstComeFirstServe,

            // 6 decimals for lender MPT shares
            Scale:
                6,

            Flags:
                0
        };


        console.log(
            "\nCreating Vault..."
        );


        // ============================================
        // SUBMIT
        // ============================================

        const result: any =
            await client.submitAndWait(
                tx,
                {
                    wallet:
                        ayze,

                    autofill:
                        true
                }
            );


        const meta: any =
            result.result.meta;


        if (
            typeof meta !== "object"
        ) {
            throw new Error(
                "No transaction metadata"
            );
        }


        console.log(
            "VaultCreate:",
            meta.TransactionResult
        );


        if (
            meta.TransactionResult !==
            "tesSUCCESS"
        ) {

            throw new Error(
                `VaultCreate failed: ${meta.TransactionResult}`
            );
        }


        // ============================================
        // FIND VAULT
        // ============================================

        const vaultNode =
            meta.AffectedNodes.find(
                (node: any) =>
                    node.CreatedNode
                        ?.LedgerEntryType ===
                    "Vault"
            );


        if (!vaultNode) {

            throw new Error(
                "Vault ledger object not found"
            );
        }


        const vaultID =
            vaultNode
                .CreatedNode
                .LedgerIndex;


        // ============================================
        // READ VAULT ON-CHAIN
        // ============================================

        const response: any =
            await client.request({

                command:
                    "ledger_entry",

                index:
                    vaultID,

                ledger_index:
                    "validated"
            });


        const vault =
            response.result.node;


        // ============================================
        // DISPLAY
        // ============================================

        console.log(
            "\n=============================="
        );

        console.log(
            "       VAULT CREATED"
        );

        console.log(
            "=============================="
        );


        console.log(
            "Vault ID:",
            vaultID
        );

        console.log(
            "Owner / Manager:",
            vault.Owner
        );

        console.log(
            "Pseudo-account:",
            vault.Account
        );

        console.log(
            "Share MPT ID:",
            vault.ShareMPTID
        );

        console.log(
            "AssetsTotal:",
            vault.AssetsTotal ?? "0"
        );

        console.log(
            "AssetsAvailable:",
            vault.AssetsAvailable ?? "0"
        );

        console.log(
            "AssetsMaximum:",
            vault.AssetsMaximum ?? "0"
        );

        console.log(
            "Scale:",
            vault.Scale
        );

        console.log(
            "WithdrawalPolicy:",
            vault.WithdrawalPolicy
        );


        // ============================================
        // SAVE
        // ============================================

        const vaultData = {

            vaultID,

            owner:
                vault.Owner,

            pseudoAccount:
                vault.Account,

            shareMPTID:
                vault.ShareMPTID,

            asset: {
                currency:
                    "USD",

                issuer
            },

            assetsMaximum:
                vault.AssetsMaximum
                ?? "100000",

            scale:
                vault.Scale
                ?? 6,

            withdrawalPolicy:
                vault.WithdrawalPolicy
        };


        fs.writeFileSync(
            "state/vault.json",

            JSON.stringify(
                vaultData,
                null,
                2
            )
        );


        console.log(
            "\nvault.json saved"
        );


        // ============================================
        // ARCHITECTURE
        // ============================================

        console.log(
            "\nArchitecture:"
        );

        console.log(
            "AYZE = Vault manager"
        );

        console.log(
            "Lenders = liquidity providers"
        );

        console.log(
            "Lenders receive MPT shares"
        );

        console.log(
            "AYZE does NOT receive lender shares"
        );

    }

    finally {

        if (
            client.isConnected()
        ) {

            await client.disconnect();
        }
    }
}


// ============================================
// RUN
// ============================================

main().catch(
    (err) => {

        console.error(
            "\nERROR:",
            err.message
        );

        process.exit(1);
    }
);
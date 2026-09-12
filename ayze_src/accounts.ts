import {
    Client,
    Wallet,
    Payment,
    xrpToDrops
} from "xrpl";

import fs from "fs";

const WSS =
    "wss://lending-hackathon.dev.ripplex.io:51233";

const client =
    new Client(WSS);

// ==================================================
// XRPL STANDALONE / HACKATHON GENESIS ACCOUNT
//
// This seed is ONLY for the isolated test ledger.
// Never use this architecture on Mainnet.
// ==================================================

const GENESIS_SEED =
    "snoPBrXtMeMyMHUVTgbuqAfg1SUTb";

const FUND_AMOUNT_XRP =
    "100";

async function genesisExists(
    genesis: Wallet
): Promise<void> {

    const response =
        await client.request({
            command: "account_info",

            account:
                genesis.address,

            ledger_index:
                "validated"
        });

    console.log(
        "Genesis account:",
        genesis.address
    );

    console.log(
        "Genesis balance:",
        response.result
            .account_data
            .Balance,
        "drops"
    );
}

async function createAndFundAccount(
    name: string,
    genesis: Wallet
) {
    const wallet =
        Wallet.generate();

    const tx: Payment = {
        TransactionType:
            "Payment",

        Account:
            genesis.address,

        Destination:
            wallet.address,

        Amount:
            xrpToDrops(
                FUND_AMOUNT_XRP
            )
    };

    console.log(
        `\nFunding ${name}...`
    );

    console.log(
        "Address:",
        wallet.address
    );

    const result =
        await client.submitAndWait(
            tx,
            {
                wallet:
                    genesis,

                autofill:
                    true
            }
        );

    const meta =
        result.result.meta;

    if (
        typeof meta !== "object"
    ) {
        throw new Error(
            `${name}: metadata missing`
        );
    }

    if (
        meta.TransactionResult !==
        "tesSUCCESS"
    ) {
        throw new Error(
            `${name}: funding failed: ` +
            meta.TransactionResult
        );
    }

    // ------------------------------------------
    // Verify from validated ledger
    // ------------------------------------------

    const accountInfo =
        await client.request({
            command:
                "account_info",

            account:
                wallet.address,

            ledger_index:
                "validated"
        });

    console.log(
        `${name}: funded`
    );

    console.log(
        "Balance:",
        accountInfo.result
            .account_data
            .Balance,
        "drops"
    );

    console.log(
        "Funding tx:",
        result.result.hash
    );

    return {
        address:
            wallet.address,

        seed:
            wallet.seed,

        publicKey:
            wallet.publicKey
    };
}

async function main() {

    await client.connect();

    try {

        console.log(
            "\n=============================="
        );

        console.log(
            "       AYZE ACCOUNTS"
        );

        console.log(
            "=============================="
        );

        console.log(
            "Network:",
            WSS
        );

        // ------------------------------------------
        // Genesis wallet
        // ------------------------------------------

        const genesis =
            Wallet.fromSeed(
                GENESIS_SEED
            );

        await genesisExists(
            genesis
        );

        // ------------------------------------------
        // AYZE actors
        // ------------------------------------------

        const issuer =
            await createAndFundAccount(
                "ISSUER",
                genesis
            );

        const lender =
            await createAndFundAccount(
                "LENDER",
                genesis
            );

        const borrower =
            await createAndFundAccount(
                "BORROWER",
                genesis
            );

        const ayze =
            await createAndFundAccount(
                "AYZE",
                genesis
            );

        const broker =
            await createAndFundAccount(
                "BROKER",
                genesis
            );

        const insurer =
            await createAndFundAccount(
                "INSURER",
                genesis
            );

        // ------------------------------------------
        // Save accounts
        // ------------------------------------------

        const accounts = {
            network:
                WSS,

            issuer,

            lender,

            borrower,

            ayze,

            broker,

            insurer
        };

        fs.writeFileSync(
            "accounts.json",

            JSON.stringify(
                accounts,
                null,
                2
            )
        );

        console.log(
            "\n=============================="
        );

        console.log(
            "      ACCOUNTS CREATED"
        );

        console.log(
            "=============================="
        );

        console.log(
            "Issuer:",
            issuer.address
        );

        console.log(
            "Lender:",
            lender.address
        );

        console.log(
            "Borrower:",
            borrower.address
        );

        console.log(
            "AYZE:",
            ayze.address
        );

        console.log(
            "Broker:",
            broker.address
        );

        console.log(
            "Insurer:",
            insurer.address
        );

        console.log(
            "\naccounts.json saved."
        );

    } finally {

        if (
            client.isConnected()
        ) {
            await client.disconnect();
        }
    }
}

main().catch(
    (error) => {

        console.error(
            "\nERROR:",
            error
        );

        process.exit(1);
    }
);
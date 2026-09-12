import { Client, Wallet } from "xrpl";
import fs from "fs";

const client = new Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const accounts = JSON.parse(
    fs.readFileSync("accounts.json", "utf8")
);

const brokerData = JSON.parse(
    fs.readFileSync("broker.json", "utf8")
);


// ============================================
// CONFIG
// ============================================

// Montant de référence pour le prototype
const LOAN_TOTAL_DUE = 1033;

// Schéma AYZE : 90% first-loss
const COVER_RATE = 0.90;

const round2 = (n: number) =>
    Math.ceil(n * 100) / 100;


// ============================================
// USD BALANCE
// ============================================

async function getUSDBalance(
    address: string
): Promise<number> {

    const response: any =
        await client.request({
            command: "account_lines",
            account: address,
            peer: accounts.issuer.address
        });

    const line =
        response.result.lines.find(
            (l: any) =>
                l.currency === "USD"
        );

    return Number(
        line?.balance ?? 0
    );
}


// ============================================
// SUBMIT
// ============================================

async function submit(
    tx: any,
    wallet: Wallet
) {

    const result =
        await client.submitAndWait(
            tx,
            {
                wallet,
                autofill: true
            }
        );

    const meta: any =
        result.result.meta;

    if (typeof meta !== "object") {
        throw new Error(
            "No transaction metadata"
        );
    }

    console.log(
        `${tx.TransactionType}:`,
        meta.TransactionResult
    );

    if (
        meta.TransactionResult !==
        "tesSUCCESS"
    ) {

        throw new Error(
            `${tx.TransactionType} failed: ${meta.TransactionResult}`
        );
    }

    return result;
}


// ============================================
// MAIN
// ============================================

async function main() {

    await client.connect();

    try {

        const ayze =
            Wallet.fromSeed(
                accounts.ayze.seed
            );

        const broker =
            Wallet.fromSeed(
                accounts.broker.seed
            );

        const issuer =
            accounts.issuer.address;


        // ============================================
        // TARGET COVER
        // ============================================

        const targetCover =
            round2(
                LOAN_TOTAL_DUE *
                COVER_RATE
            );


        // ============================================
        // CURRENT COVER ON-CHAIN
        // ============================================

        const brokerEntry: any =
            await client.request({
                command:
                    "ledger_entry",

                index:
                    brokerData.loanBrokerID,

                ledger_index:
                    "validated"
            });


        const currentCover =
            Number(
                brokerEntry
                    .result
                    .node
                    .CoverAvailable ?? 0
            );


        const missingCover =
            round2(
                Math.max(
                    0,
                    targetCover -
                    currentCover
                )
            );


        console.log(
            "\n=============================="
        );

        console.log(
            "      AYZE FIRST-LOSS COVER"
        );

        console.log(
            "=============================="
        );


        console.log(
            "LoanBroker:",
            brokerData.loanBrokerID
        );

        console.log(
            "Loan total due:",
            LOAN_TOTAL_DUE,
            "USD"
        );

        console.log(
            "Target cover:",
            targetCover,
            "USD (90%)"
        );

        console.log(
            "Current CoverAvailable:",
            currentCover,
            "USD"
        );

        console.log(
            "Missing cover:",
            missingCover,
            "USD"
        );


        if (missingCover <= 0) {

            console.log(
                "\nCover already sufficient."
            );

            return;
        }


        // ============================================
        // BROKER BALANCE
        // ============================================

        let brokerBalance =
            await getUSDBalance(
                broker.address
            );


        console.log(
            "\nBroker USD balance:",
            brokerBalance
        );


        // ============================================
        // DEMO FUNDING
        //
        // Only necessary because this is Devnet.
        // In production this is Broker capital.
        // ============================================

        if (
            brokerBalance <
            missingCover
        ) {

            const amountNeeded =
                round2(
                    missingCover -
                    brokerBalance
                );


            console.log(
                "Funding Broker:",
                amountNeeded,
                "USD"
            );


            const issuerWallet =
                Wallet.fromSeed(
                    accounts.issuer.seed
                );


            // Broker must have USD TrustLine

            const brokerLines: any =
                await client.request({
                    command:
                        "account_lines",

                    account:
                        broker.address,

                    peer:
                        issuer
                });


            const brokerUSD =
                brokerLines
                    .result
                    .lines
                    .find(
                        (line: any) =>
                            line.currency ===
                            "USD"
                    );


            if (!brokerUSD) {

                console.log(
                    "Creating Broker USD TrustLine..."
                );


                await submit(
                    {
                        TransactionType:
                            "TrustSet",

                        Account:
                            broker.address,

                        LimitAmount: {
                            currency:
                                "USD",

                            issuer,

                            value:
                                "100000"
                        }
                    },

                    broker
                );
            }


            await submit(
                {
                    TransactionType:
                        "Payment",

                    Account:
                        issuerWallet.address,

                    Destination:
                        broker.address,

                    Amount: {
                        currency:
                            "USD",

                        issuer,

                        value:
                            amountNeeded.toString()
                    }
                },

                issuerWallet
            );


            brokerBalance =
                await getUSDBalance(
                    broker.address
                );
        }



        // ============================================
        // ENSURE AYZE USD TRUSTLINE
        // ============================================

        const ayzeLines: any =
            await client.request({
                command: "account_lines",
                account: ayze.address,
                peer: issuer,
                ledger_index: "validated"
            });

        const ayzeUSD =
            ayzeLines.result.lines.find(
                (line: any) =>
                    line.currency === "USD"
            );

        if (!ayzeUSD) {

            console.log(
                "\nCreating AYZE USD TrustLine..."
            );

            await submit(
                {
                    TransactionType: "TrustSet",

                    Account: ayze.address,

                    LimitAmount: {
                        currency: "USD",
                        issuer,
                        value: "100000"
                    }
                },

                ayze
            );
        }

        // ============================================
        // BROKER -> AYZE
        //
        // Economic source of first-loss = Broker
        // ============================================

        console.log(
            "\nBroker -> AYZE:",
            missingCover,
            "USD"
        );


        await submit(
            {
                TransactionType:
                    "Payment",

                Account:
                    broker.address,

                Destination:
                    ayze.address,

                Amount: {
                    currency:
                        "USD",

                    issuer,

                    value:
                        missingCover.toString()
                }
            },

            broker
        );


        // ============================================
        // AYZE -> LOANBROKER COVER
        //
        // XLS-66 requires LoanBroker Owner
        // to submit LoanBrokerCoverDeposit.
        // ============================================

        console.log(
            "AYZE -> LoanBrokerCoverDeposit:",
            missingCover,
            "USD"
        );


        await submit(
            {
                TransactionType:
                    "LoanBrokerCoverDeposit",

                Account:
                    ayze.address,

                LoanBrokerID:
                    brokerData.loanBrokerID,

                Amount: {
                    currency:
                        "USD",

                    issuer,

                    value:
                        missingCover.toString()
                }
            },

            ayze
        );


        // ============================================
        // VERIFY COVER
        // ============================================

        const after: any =
            await client.request({
                command:
                    "ledger_entry",

                index:
                    brokerData.loanBrokerID,

                ledger_index:
                    "validated"
            });


        const coverAvailable =
            Number(
                after
                    .result
                    .node
                    .CoverAvailable ?? 0
            );


        console.log(
            "\n=============================="
        );

        console.log(
            "       COVER READY"
        );

        console.log(
            "=============================="
        );


        console.log(
            "CoverAvailable:",
            coverAvailable,
            "USD"
        );

        console.log(
            "Target:",
            targetCover,
            "USD"
        );


        // ============================================
        // SAVE
        // ============================================

        const coverData = {

            loanBrokerID:
                brokerData.loanBrokerID,

            source:
                "broker",

            depositor:
                "AYZE (XLS-66 owner requirement)",

            coverRate:
                COVER_RATE,

            targetCover,

            coverAvailable
        };


        fs.writeFileSync(
            "cover.json",

            JSON.stringify(
                coverData,
                null,
                2
            )
        );


        console.log(
            "\ncover.json saved"
        );


        console.log(
            "\nArchitecture:"
        );

        console.log(
            "BROKER -> AYZE -> XLS-66 COVER"
        );

        console.log(
            "First-loss target: 90%"
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


main().catch(err => {

    console.error(
        "\nERROR:",
        err.message
    );

    process.exit(1);
});
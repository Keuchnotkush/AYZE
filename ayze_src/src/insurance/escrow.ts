import { Client, Wallet } from "xrpl";
import fs from "fs";
import { randomBytes } from "crypto";
import { PreimageSha256 } from "five-bells-condition";

const client = new Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const accounts = JSON.parse(
    fs.readFileSync("state/accounts.json", "utf8")
);

const loan = JSON.parse(
    fs.readFileSync("state/loan.json", "utf8")
);

const INSURANCE_RATE = 0.30;


// ============================================
// HELPERS
// ============================================

const round6 = (n: number) =>
    Math.ceil(n * 1_000_000) / 1_000_000;


async function ledgerTime(): Promise<number> {

    const response: any =
        await client.request({
            command: "ledger",
            ledger_index: "validated"
        });

    return Number(
        response.result.ledger.close_time
    );
}


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
// PREIMAGE-SHA-256
// ============================================

function createCryptoCondition() {

    const preimage =
        randomBytes(32);

    const fulfillment: any =
        new PreimageSha256();

    fulfillment.setPreimage(
        preimage
    );

    const fulfillmentHex =
        fulfillment
            .serializeBinary()
            .toString("hex")
            .toUpperCase();

    const conditionHex =
        fulfillment
            .getConditionBinary()
            .toString("hex")
            .toUpperCase();

    return {
        condition:
            conditionHex,

        fulfillment:
            fulfillmentHex
    };
}


// ============================================
// MAIN
// ============================================

async function main() {

    await client.connect();

    try {

        if (!accounts.insurer) {
            throw new Error(
                "INSURER absent de accounts.json"
            );
        }


        const insurer =
            Wallet.fromSeed(
                accounts.insurer.seed
            );

        const broker =
            Wallet.fromSeed(
                accounts.broker.seed
            );

        const issuer =
            accounts.issuer.address;


        // ============================================
        // LOAN DATA
        // ============================================

        const paymentAmount =
            Number(
                loan.periodicPayment
                ?? loan.paymentAmount
            );

        const paymentTotal =
            Number(
                loan.paymentTotal
            );

        const firstDue =
            Number(
                loan.nextPaymentDueDate
            );

        const paymentInterval =
            Number(
                loan.paymentInterval
            );

        const gracePeriod =
            Number(
                loan.gracePeriod
            );


        if (
            !Number.isFinite(paymentAmount) ||
            paymentAmount <= 0
        ) {
            throw new Error(
                "Periodic payment missing from loan.json"
            );
        }


        // ============================================
        // INSURANCE PER PAYMENT
        // ============================================

        const insurancePerPayment =
            round6(
                paymentAmount *
                INSURANCE_RATE
            );

        const totalInsurance =
            round6(
                insurancePerPayment *
                paymentTotal
            );


        console.log(
            "\n=============================="
        );

        console.log(
            "    AYZE INSURANCE ESCROWS"
        );

        console.log(
            "=============================="
        );

        console.log(
            "Loan:",
            loan.loanID
        );

        console.log(
            "Insurer:",
            insurer.address
        );

        console.log(
            "Broker:",
            broker.address
        );

        console.log(
            "\nPayments:",
            paymentTotal
        );

        console.log(
            "Payment amount:",
            paymentAmount,
            "USD"
        );

        console.log(
            "Insurance rate:",
            "30% per payment"
        );

        console.log(
            "Insurance/payment:",
            insurancePerPayment,
            "USD"
        );

        console.log(
            "Total insurance:",
            totalInsurance,
            "USD"
        );


        // ============================================
        // CHECK INSURER BALANCE
        // ============================================

        const insurerBalance =
            await getUSDBalance(
                insurer.address
            );


        console.log(
            "\nInsurer balance:",
            insurerBalance,
            "USD"
        );


        if (
            insurerBalance <
            totalInsurance
        ) {
            throw new Error(
                `Insurer needs ${totalInsurance} USD but only has ${insurerBalance} USD`
            );
        }


        // ============================================
        // BROKER TRUSTLINE
        // ============================================

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
                "\nCreating Broker USD TrustLine..."
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


        // ============================================
        // LEDGER TIME
        // ============================================

        const now =
            await ledgerTime();


        console.log(
            "\nLedger time:",
            now
        );


        // ============================================
        // CREATE A/B/C ESCROWS
        // ============================================

        const escrows: any[] = [];


        for (
            let i = 0;
            i < paymentTotal;
            i++
        ) {

            const paymentIndex =
                i + 1;


            const dueDate =
                firstDue +
                paymentInterval * i;


            /*
                Escrow stays alive through:

                payment due date
                    +
                grace period
                    +
                120 sec buffer
            */

            const cancelAfter =
                dueDate +
                gracePeriod +
                120;


            if (
                cancelAfter <= now
            ) {

                throw new Error(
                    `Escrow ${paymentIndex} already expired`
                );
            }


            const {
                condition,
                fulfillment
            } = createCryptoCondition();


            const escrowName =
                String.fromCharCode(
                    65 + i
                );


            console.log(
                `\n------------------------------`
            );

            console.log(
                `ESCROW ${escrowName}`
            );

            console.log(
                `Payment #${paymentIndex}`
            );

            console.log(
                `Due: ${dueDate}`
            );

            console.log(
                `Insurance: ${insurancePerPayment} USD`
            );

            console.log(
                `Expiry: ${cancelAfter}`
            );


            // ========================================
            // ESCROW CREATE
            // ========================================

            const escrowTx: any = {

                TransactionType:
                    "EscrowCreate",

                Account:
                    insurer.address,

                Destination:
                    broker.address,

                Amount: {
                    currency:
                        "USD",

                    issuer,

                    value:
                        insurancePerPayment
                            .toString()
                },

                Condition:
                    condition,

                CancelAfter:
                    cancelAfter
            };


            const result =
                await submit(
                    escrowTx,
                    insurer
                );


            // ========================================
            // SEQUENCE
            // ========================================

            const txJson: any =
                result.result.tx_json;


            const offerSequence =
                Number(
                    txJson.Sequence
                );


            if (
                !Number.isFinite(
                    offerSequence
                )
            ) {
                throw new Error(
                    `Unable to retrieve sequence for Escrow ${escrowName}`
                );
            }


            // ========================================
            // FIND ESCROW LEDGER OBJECT
            // ========================================

            const meta: any =
                result.result.meta;


            const escrowNode =
                meta.AffectedNodes.find(
                    (node: any) =>
                        node.CreatedNode
                            ?.LedgerEntryType
                        === "Escrow"
                );


            if (!escrowNode) {

                throw new Error(
                    `Escrow ${escrowName} ledger object not found`
                );
            }


            const escrowID =
                escrowNode
                    .CreatedNode
                    .LedgerIndex;


            console.log(
                `Escrow ${escrowName} ID:`,
                escrowID
            );


            // ========================================
            // SAVE ESCROW DATA
            // ========================================

            escrows.push({

                name:
                    escrowName,

                paymentIndex,

                dueDate,

                paymentAmount,

                insuranceRate:
                    INSURANCE_RATE,

                amount:
                    insurancePerPayment,

                escrowID,

                owner:
                    insurer.address,

                destination:
                    broker.address,

                offerSequence,

                condition,

                /*
                    DEMO ONLY.

                    In production the fulfillment
                    must not be stored in plaintext
                    with public application data.
                */

                fulfillment,

                cancelAfter,

                status:
                    "LOCKED"
            });
        }


        // ============================================
        // CHECK BALANCE AFTER
        // ============================================

        const afterBalance =
            await getUSDBalance(
                insurer.address
            );


        // ============================================
        // SAVE escrow.json
        // ============================================

        const escrowData = {

            loanID:
                loan.loanID,

            insurer:
                insurer.address,

            broker:
                broker.address,

            issuer,

            insuranceRate:
                INSURANCE_RATE,

            paymentTotal,

            paymentAmount,

            insurancePerPayment,

            totalInsurance,

            escrows
        };


        fs.writeFileSync(
            "state/escrow.json",

            JSON.stringify(
                escrowData,
                null,
                2
            )
        );


        // ============================================
        // RESULT
        // ============================================

        console.log(
            "\n=============================="
        );

        console.log(
            "      INSURANCE ACTIVE"
        );

        console.log(
            "=============================="
        );


        for (
            const escrow
            of escrows
        ) {

            console.log(
                `Escrow ${escrow.name}: ${escrow.amount} USD -> payment ${escrow.paymentIndex}`
            );
        }


        console.log(
            "\nTotal locked:",
            totalInsurance,
            "USD"
        );

        console.log(
            "Insurer balance before:",
            insurerBalance,
            "USD"
        );

        console.log(
            "Insurer balance after:",
            afterBalance,
            "USD"
        );


        console.log(
            "\nINSURER -> ESCROWS A/B/C -> BROKER"
        );

        console.log(
            "30% insurance per payment"
        );


        console.log(
            "\nescrow.json saved"
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

main().catch(err => {

    console.error(
        "\nERROR:",
        err.message
    );

    process.exit(1);
});
import * as xrpl from "xrpl";
import fs from "fs";

const client = new xrpl.Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const accounts = JSON.parse(
    fs.readFileSync("accounts.json", "utf8")
);

const broker = JSON.parse(
    fs.readFileSync("broker.json", "utf8")
);

// ============================================
// TRACK 1 - OPEN-ENDED VAULT
// No SubscriptionDate / RedemptionDate.
// The loan is term-bound; the vault is not.
// ============================================

const PRINCIPAL = "1000";
const INTEREST_RATE = 20000;   // 20% annualized: units are 1/10th basis points
const PAYMENT_TOTAL = 3;
const PAYMENT_INTERVAL = 600;  // 10 minutes for the demo
const GRACE_PERIOD = 60;

// AYZE fees
const LOAN_ORIGINATION_FEE = "5";
const LOAN_SERVICE_FEE = "1";
const LATE_PAYMENT_FEE = "2";
const CLOSE_PAYMENT_FEE = "2";

async function submitSimple(
    tx: any,
    wallet: xrpl.Wallet
) {
    const result = await client.submitAndWait(
        tx,
        {
            wallet,
            autofill: true
        }
    );

    const meta: any = result.result.meta;

    if (typeof meta !== "object") {
        throw new Error("No transaction metadata");
    }

    console.log(
        `${tx.TransactionType}:`,
        meta.TransactionResult
    );

    if (meta.TransactionResult !== "tesSUCCESS") {
        throw new Error(
            `${tx.TransactionType} failed: ${meta.TransactionResult}`
        );
    }

    return result;
}

async function ensureBorrowerTrustLine(
    borrower: xrpl.Wallet,
    issuer: string
) {
    const lines: any = await client.request({
        command: "account_lines",
        account: borrower.address,
        peer: issuer
    });

    const usdLine = lines.result.lines.find(
        (line: any) => line.currency === "USD"
    );

    if (usdLine) {
        console.log("Borrower USD TrustLine already exists.");
        return;
    }

    console.log("Creating borrower USD TrustLine...");

    await submitSimple(
        {
            TransactionType: "TrustSet",
            Account: borrower.address,
            LimitAmount: {
                currency: "USD",
                issuer,
                value: "100000"
            }
        },
        borrower
    );
}

async function getUSDBalance(
    address: string,
    issuer: string
): Promise<number> {
    const lines: any = await client.request({
        command: "account_lines",
        account: address,
        peer: issuer
    });

    const usdLine = lines.result.lines.find(
        (line: any) => line.currency === "USD"
    );

    return Number(usdLine?.balance ?? 0);
}

async function main() {
    await client.connect();

    try {
        const borrower = xrpl.Wallet.fromSeed(
            accounts.borrower.seed
        );

        // AYZE owns the LoanBroker ledger entry.
        // Therefore AYZE is the Loan Broker signer.
        const ayze = xrpl.Wallet.fromSeed(
            accounts.ayze.seed
        );

        const issuer = accounts.issuer.address;

        console.log(
            "\n=============================="
        );
        console.log(
            "      AYZE TRACK 1 LOAN"
        );
        console.log(
            "=============================="
        );

        console.log("Loan Broker:", ayze.address);
        console.log("Borrower   :", borrower.address);
        console.log(
            "LoanBrokerID:",
            broker.loanBrokerID
        );

        await ensureBorrowerTrustLine(
            borrower,
            issuer
        );

        const balanceBefore =
            await getUSDBalance(
                borrower.address,
                issuer
            );

        // ============================================
        // OFFICIAL LoanSet COSIGN FLOW
        //
        // Account signs first.
        // Counterparty signs second.
        // ============================================

        const loanSetTx: any =
            await client.autofill({
                TransactionType: "LoanSet",

                Account: ayze.address,
                Counterparty: borrower.address,

                LoanBrokerID:
                    broker.loanBrokerID,

                PrincipalRequested:
                    PRINCIPAL,

                InterestRate:
                    INTEREST_RATE,

                LoanOriginationFee:
                    LOAN_ORIGINATION_FEE,

                LoanServiceFee:
                    LOAN_SERVICE_FEE,

                LatePaymentFee:
                    LATE_PAYMENT_FEE,

                ClosePaymentFee:
                    CLOSE_PAYMENT_FEE,

                PaymentTotal:
                    PAYMENT_TOTAL,

                PaymentInterval:
                    PAYMENT_INTERVAL,

                GracePeriod:
                    GRACE_PERIOD
            } as any);

        console.log(
            "\nLoan terms prepared."
        );

        // 1) Loan Broker / AYZE signs first.
        const brokerSigned =
            ayze.sign(loanSetTx);

        const brokerSignedTx: any =
            xrpl.decode(
                brokerSigned.tx_blob
            );

        // 2) Borrower signs as Counterparty.
        const fullySigned =
            xrpl.signLoanSetByCounterparty(
                borrower,
                brokerSignedTx
            );

        xrpl.validate(
            fullySigned.tx
        );

        console.log(
            "Submitting cosigned LoanSet..."
        );

        const result: any =
            await client.submitAndWait(
                fullySigned.tx
            );

        const meta: any =
            result.result.meta;

        if (typeof meta !== "object") {
            throw new Error(
                "No transaction metadata"
            );
        }

        console.log(
            "LoanSet:",
            meta.TransactionResult
        );

        if (
            meta.TransactionResult !==
            "tesSUCCESS"
        ) {
            throw new Error(
                `LoanSet failed: ${meta.TransactionResult}`
            );
        }

        const loanNode =
            meta.AffectedNodes.find(
                (node: any) =>
                    node.CreatedNode
                        ?.LedgerEntryType ===
                    "Loan"
            );

        if (!loanNode?.CreatedNode) {
            throw new Error(
                "Loan ledger object not found."
            );
        }

        const loanID =
            loanNode.CreatedNode.LedgerIndex;

        // Read the canonical post-transaction Loan state.
        const loanEntry: any =
            await client.request({
                command: "ledger_entry",
                index: loanID,
                ledger_index: "validated"
            });

        const loan =
            loanEntry.result.node;

        const balanceAfter =
            await getUSDBalance(
                borrower.address,
                issuer
            );

        console.log(
            "\n=============================="
        );
        console.log(
            "         LOAN CREATED"
        );
        console.log(
            "=============================="
        );

        console.log("Loan ID:", loanID);
        console.log(
            "Borrower received:",
            balanceAfter - balanceBefore,
            "USD"
        );
        console.log(
            "PeriodicPayment:",
            loan.PeriodicPayment
        );
        console.log(
            "PaymentRemaining:",
            loan.PaymentRemaining
        );
        console.log(
            "TotalValueOutstanding:",
            loan.TotalValueOutstanding
        );
        console.log(
            "NextPaymentDueDate:",
            loan.NextPaymentDueDate
        );

        const brokerEntry: any =
            await client.request({
                command: "ledger_entry",
                index: broker.loanBrokerID,
                ledger_index: "validated"
            });

        console.log(
            "DebtTotal:",
            brokerEntry.result.node.DebtTotal
        );
        console.log(
            "CoverAvailable:",
            brokerEntry.result.node.CoverAvailable
        );

        fs.writeFileSync(
            "loan.json",
            JSON.stringify(
                {
                    loanID,
                    borrower: borrower.address,
                    principal: PRINCIPAL,
                    periodicPayment:
                        loan.PeriodicPayment,
                    paymentTotal:
                        PAYMENT_TOTAL,
                    paymentInterval:
                        PAYMENT_INTERVAL,
                    gracePeriod:
                        GRACE_PERIOD,
                    nextPaymentDueDate:
                        loan.NextPaymentDueDate,
                    totalValueOutstanding:
                        loan.TotalValueOutstanding
                },
                null,
                2
            )
        );

        console.log(
            "\nloan.json saved"
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

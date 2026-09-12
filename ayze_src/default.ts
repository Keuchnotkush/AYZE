import { Client, Wallet } from "xrpl";
import fs from "fs";

const client = new Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const accounts = JSON.parse(
    fs.readFileSync("accounts.json", "utf8")
);

const loan = JSON.parse(
    fs.readFileSync("loan.json", "utf8")
);

const broker = JSON.parse(
    fs.readFileSync("broker.json", "utf8")
);

const escrowFile = JSON.parse(
    fs.readFileSync("escrow.json", "utf8")
);

// escrow.ts writes one escrow per scheduled payment
// (escrowFile.escrows). Claim the first one still
// locked and not yet expired: it is the missed payment.
const nowRipple =
    Math.floor(Date.now() / 1000) - 946_684_800;

const escrow =
    escrowFile.escrows.find(
        (e: any) =>
            e.status === "LOCKED" &&
            e.cancelAfter > nowRipple
    );

if (!escrow) {
    throw new Error(
        "No claimable escrow left in escrow.json"
    );
}

const TF_LOAN_DEFAULT = 65536;


// ============================================
// LEDGER ENTRY
// ============================================

async function getLedgerEntry(index: string) {

    const response: any =
        await client.request({
            command: "ledger_entry",
            index,
            ledger_index: "validated"
        });

    return response.result.node;
}


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

    return {
        result,
        code: meta.TransactionResult
    };
}


// ============================================
// WAIT UNTIL DEFAULT POSSIBLE
// ============================================

async function waitUntilDefault() {

    while (true) {

        const loanEntry =
            await getLedgerEntry(
                loan.loanID
            );

        const ledger: any =
            await client.request({
                command: "ledger",
                ledger_index: "validated"
            });

        const now =
            Number(
                ledger.result.ledger.close_time
            );

        const nextPayment =
            Number(
                loanEntry.NextPaymentDueDate
            );

        const gracePeriod =
            Number(
                loanEntry.GracePeriod
            );

        const defaultTime =
            nextPayment +
            gracePeriod;

        const remaining =
            defaultTime - now;


        if (remaining <= 0) {

            console.log(
                "\nLoan can now be defaulted."
            );

            return;
        }


        process.stdout.write(
            `\rWaiting for default: ${remaining}s `
        );


        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    5000
                )
        );
    }
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

        const brokerWallet =
            Wallet.fromSeed(
                accounts.broker.seed
            );


        console.log(
            "\n=============================="
        );

        console.log(
            "       AYZE DEFAULT ENGINE"
        );

        console.log(
            "=============================="
        );


        console.log(
            "Loan:",
            loan.loanID
        );

        console.log(
            "LoanBroker:",
            broker.loanBrokerID
        );

        console.log(
            "AYZE:",
            ayze.address
        );

        console.log(
            "Insurance:",
            escrow.amount,
            "USD"
        );


        // ============================================
        // 1. STATE BEFORE DEFAULT
        // ============================================

        const loanBefore =
            await getLedgerEntry(
                loan.loanID
            );

        const brokerBefore =
            await getLedgerEntry(
                broker.loanBrokerID
            );


        console.log(
            "\n--- BEFORE DEFAULT ---"
        );

        console.log(
            "Principal outstanding:",
            loanBefore.PrincipalOutstanding
        );

        console.log(
            "Total outstanding:",
            loanBefore.TotalValueOutstanding
        );

        console.log(
            "CoverAvailable:",
            brokerBefore.CoverAvailable
        );

        console.log(
            "DebtTotal:",
            brokerBefore.DebtTotal
        );


        const brokerBalanceBefore =
            await getUSDBalance(
                brokerWallet.address
            );


        console.log(
            "Broker USD balance:",
            brokerBalanceBefore
        );


        // ============================================
        // 2. WAIT FOR DEFAULT WINDOW
        // ============================================

        console.log(
            "\nWaiting for payment deadline + grace period..."
        );


        await waitUntilDefault();


        // ============================================
        // 3. DEFAULT LOAN
        //
        // Only AYZE can do this because AYZE owns
        // the LoanBroker.
        // ============================================

        console.log(
            "\nSubmitting LoanManage default..."
        );


        const defaultTx: any = {

            TransactionType:
                "LoanManage",

            Account:
                ayze.address,

            LoanID:
                loan.loanID,

            Flags:
                TF_LOAN_DEFAULT
        };


        const defaultResponse =
            await submit(
                defaultTx,
                ayze
            );


        if (
            defaultResponse.code !==
            "tesSUCCESS"
        ) {

            if (
                defaultResponse.code ===
                "tecTOO_SOON"
            ) {
                throw new Error(
                    "Loan cannot be defaulted yet."
                );
            }

            throw new Error(
                `Default failed: ${defaultResponse.code}`
            );
        }


        console.log(
            "\nLOAN DEFAULT CONFIRMED ON XRPL"
        );


        // ============================================
        // 4. VERIFY XLS-66 COVER
        // ============================================

        const brokerAfter =
            await getLedgerEntry(
                broker.loanBrokerID
            );


        console.log(
            "\n--- XLS-66 AFTER DEFAULT ---"
        );


        console.log(
            "Cover before:",
            brokerBefore.CoverAvailable
        );

        console.log(
            "Cover after:",
            brokerAfter.CoverAvailable
        );


        console.log(
            "Debt before:",
            brokerBefore.DebtTotal
        );

        console.log(
            "Debt after:",
            brokerAfter.DebtTotal
        );


        // ============================================
        // 5. CALCULATE COVER USED
        // ============================================

        const coverBefore =
            Number(
                brokerBefore.CoverAvailable
            );

        const coverAfter =
            Number(
                brokerAfter.CoverAvailable
            );

        const coverUsed =
            coverBefore -
            coverAfter;


        console.log(
            "\nFirst-loss used:",
            coverUsed,
            "USD"
        );


        // ============================================
        // 6. INSURANCE TRIGGER
        //
        // IMPORTANT:
        //
        // We only reach this point if LoanManage
        // returned tesSUCCESS.
        //
        // AYZE can now reveal/use the fulfillment.
        // ============================================

        console.log(
            "\n=============================="
        );

        console.log(
            "     INSURANCE TRIGGER"
        );

        console.log(
            "=============================="
        );


        console.log(
            "Default validated."
        );

        console.log(
            "Releasing insurance..."
        );


        // ============================================
        // 7. ESCROW FINISH
        //
        // INSURER
        //    ↓
        // ESCROW
        //    ↓
        // BROKER
        //
        // Broker submits EscrowFinish.
        // ============================================

        const finishTx: any = {

            TransactionType:
                "EscrowFinish",

            Account:
                brokerWallet.address,

            Owner:
                escrow.owner,

            OfferSequence:
                escrow.offerSequence,

            Condition:
                escrow.condition,

            Fulfillment:
                escrow.fulfillment
        };


        const finishResponse =
            await submit(
                finishTx,
                brokerWallet
            );


        if (
            finishResponse.code !==
            "tesSUCCESS"
        ) {

            throw new Error(
                `Insurance release failed: ${finishResponse.code}`
            );
        }


        // ============================================
        // 8. VERIFY BROKER RECEIVED INSURANCE
        // ============================================

        const brokerBalanceAfter =
            await getUSDBalance(
                brokerWallet.address
            );


        const insuranceReceived =
            brokerBalanceAfter -
            brokerBalanceBefore;


        console.log(
            "\nESCROW RELEASED"
        );


        console.log(
            "Broker before:",
            brokerBalanceBefore,
            "USD"
        );


        console.log(
            "Broker after:",
            brokerBalanceAfter,
            "USD"
        );


        console.log(
            "Insurance received:",
            insuranceReceived,
            "USD"
        );


        // ============================================
        // 9. UPDATE escrow.json
        // ============================================

        escrow.status =
            "CLAIMED";

        escrow.claimedAt =
            new Date()
                .toISOString();

        escrow.trigger =
            "XLS-66_LOAN_DEFAULT";


        fs.writeFileSync(
            "escrow.json",

            JSON.stringify(
                escrow,
                null,
                2
            )
        );


        // ============================================
        // FINAL RESULT
        // ============================================

        console.log(
            "\n=============================="
        );

        console.log(
            "       AYZE DEFAULT DONE"
        );

        console.log(
            "=============================="
        );


        console.log(
            "Loan default      : CONFIRMED"
        );


        console.log(
            `XLS-66 first-loss : ${coverUsed} USD`
        );


        console.log(
            `Insurance payout  : ${insuranceReceived} USD`
        );


        console.log(
            "Insurance route   : INSURER -> ESCROW -> BROKER"
        );


        console.log(
            "\nAYZE successfully orchestrated the default."
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
    err => {

        console.error(
            "\nERROR:",
            err.message
        );

        process.exit(1);
    }
);
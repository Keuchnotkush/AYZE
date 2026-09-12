import * as xrpl from "xrpl";
import fs from "fs";

const client = new xrpl.Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const accounts = JSON.parse(
    fs.readFileSync("accounts.json", "utf8")
);

const loanData = JSON.parse(
    fs.readFileSync("loan.json", "utf8")
);

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

async function getLoan() {
    const response: any =
        await client.request({
            command: "ledger_entry",
            index: loanData.loanID,
            ledger_index: "validated"
        });

    return response.result.node;
}

async function main() {
    await client.connect();

    try {
        const ayze =
            xrpl.Wallet.fromSeed(
                accounts.ayze.seed
            );

        const loan =
            await getLoan();

        const now =
            await ledgerTime();

        const due =
            Number(
                loan.NextPaymentDueDate
            );

        const grace =
            Number(
                loan.GracePeriod
            );

        const defaultAllowedAt =
            due + grace;

        console.log(
            "\n=============================="
        );
        console.log(
            "    TRACK 1 GUARDRAIL TEST"
        );
        console.log(
            "=============================="
        );

        console.log(
            "Loan:",
            loanData.loanID
        );

        console.log(
            "Ledger time:",
            now
        );

        console.log(
            "Payment due:",
            due
        );

        console.log(
            "Grace period:",
            grace,
            "seconds"
        );

        console.log(
            "Default allowed at:",
            defaultAllowedAt
        );

        if (
            now >= defaultAllowedAt
        ) {
            throw new Error(
                "This loan is already defaultable. Run guardrail.ts immediately after loan.ts to demonstrate tecTOO_SOON."
            );
        }

        const tx: any = {
            TransactionType:
                "LoanManage",

            Account:
                ayze.address,

            LoanID:
                loanData.loanID,

            Flags:
                xrpl.LoanManageFlags
                    .tfLoanDefault
        };

        xrpl.validate(tx);

        console.log(
            "\nTrying to default the loan BEFORE due date + grace period..."
        );

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
                "No transaction metadata"
            );
        }

        const code =
            meta.TransactionResult;

        console.log(
            "LoanManage result:",
            code
        );

        if (
            code === "tecTOO_SOON"
        ) {
            console.log(
                "\n✅ GUARDRAIL PASSED"
            );
            console.log(
                "XRPL rejected an early default."
            );
            console.log(
                "The borrower is protected until the payment deadline + grace period expires."
            );
            return;
        }

        if (
            code === "tesSUCCESS"
        ) {
            throw new Error(
                "Unexpected tesSUCCESS: loan was defaulted instead of being rejected."
            );
        }

        throw new Error(
            `Transaction was rejected, but with ${code} instead of expected tecTOO_SOON.`
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

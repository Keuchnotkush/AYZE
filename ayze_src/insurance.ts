import { Client, Wallet } from "xrpl";
import fs from "fs";

const client =
    new Client("wss://lending-hackathon.dev.ripplex.io:51233");

const accounts =
    JSON.parse(fs.readFileSync("accounts.json", "utf8"));

const INSURER_CAPITAL = "1000";

async function submit(tx: any, wallet: Wallet) {

    const result =
        await client.submitAndWait(
            tx,
            {
                wallet,
                autofill: true
            }
        );

    const meta: any = result.result.meta;

    console.log(
        `${tx.TransactionType}:`,
        meta.TransactionResult
    );

    if (meta.TransactionResult !== "tesSUCCESS")
        throw new Error(meta.TransactionResult);

    return result;
}

async function main() {

    await client.connect();

    try {

        if (!accounts.insurer)
            throw new Error(
                "INSURER missing. Run addInsurer.ts first."
            );

        const insurer =
            Wallet.fromSeed(accounts.insurer.seed);

        const issuer =
            Wallet.fromSeed(accounts.issuer.seed);

        const USD = {
            currency: "USD",
            issuer: issuer.address
        };

        console.log("\n=== AYZE INSURANCE SETUP ===");
        console.log("Insurer:", insurer.address);

        // TrustLine

        const lines: any =
            await client.request({
                command: "account_lines",
                account: insurer.address,
                peer: issuer.address
            });

        const usdLine =
            lines.result.lines.find(
                (line: any) =>
                    line.currency === "USD"
            );

        if (!usdLine) {

            await submit({
                TransactionType: "TrustSet",

                Account: insurer.address,

                LimitAmount: {
                    ...USD,
                    value: "100000"
                }

            }, insurer);
        }

        // Balance

        const afterTrust: any =
            await client.request({
                command: "account_lines",
                account: insurer.address,
                peer: issuer.address
            });

        const balance =
            Number(
                afterTrust.result.lines.find(
                    (l: any) =>
                        l.currency === "USD"
                )?.balance ?? 0
            );

        // Demo funding

        if (balance < Number(INSURER_CAPITAL)) {

            const missing =
                Number(INSURER_CAPITAL) - balance;

            await submit({
                TransactionType: "Payment",

                Account: issuer.address,

                Destination: insurer.address,

                Amount: {
                    ...USD,
                    value: missing.toString()
                }

            }, issuer);
        }

        console.log(
            "\nINSURER CAPITAL:",
            INSURER_CAPITAL,
            "USD"
        );

    } finally {

        if (client.isConnected())
            await client.disconnect();
    }
}

main().catch(err => {
    console.error("\nERROR:", err.message);
    process.exit(1);
});
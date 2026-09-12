import { Client, Wallet } from "xrpl";
import fs from "fs";

const client = new Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const accounts = JSON.parse(
    fs.readFileSync("state/accounts.json", "utf8")
);


async function submit(
    tx: any,
    wallet: Wallet
) {

    const result = await client.submitAndWait(
        tx,
        {
            wallet,
            autofill: true
        }
    );

    const meta = result.result.meta;

    if (typeof meta !== "object") {
        throw new Error("Pas de metadata");
    }

    console.log(
        `${tx.TransactionType}: ${meta.TransactionResult}`
    );

    if (meta.TransactionResult !== "tesSUCCESS") {
        throw new Error(
            `${tx.TransactionType} failed: ${meta.TransactionResult}`
        );
    }

    return result;
}


async function main() {

    await client.connect();

    try {

        const issuer = Wallet.fromSeed(
            accounts.issuer.seed
        );

        const lender = Wallet.fromSeed(
            accounts.lender.seed
        );

        const USD = {
            currency: "USD",
            issuer: issuer.address
        };


        console.log("\n==============================");
        console.log("       AYZE TOKEN SETUP");
        console.log("==============================");

        console.log(
            "Issuer:",
            issuer.address
        );

        console.log(
            "Lender:",
            lender.address
        );


        
        // 1. Default Ripple
        

        await submit(
            {
                TransactionType: "AccountSet",

                Account: issuer.address,

                // asfDefaultRipple
                SetFlag: 8
            },
            issuer
        );

        console.log(
            "Default Ripple enabled"
        );


        
        // 2. Allow TrustLine Token Locking
        //
        // Nécessaire pour TokenEscrow.
        //
        // asfAllowTrustLineLocking = 17
        

        await submit(
            {
                TransactionType: "AccountSet",

                Account: issuer.address,

                SetFlag: 17
            },
            issuer
        );

        console.log(
            "TrustLine token locking enabled"
        );


        
        // 3. Vérifier TrustLine lender
        

        const lines: any =
            await client.request({
                command: "account_lines",

                account:
                    lender.address,

                peer:
                    issuer.address
            });

        const existingLine =
            lines.result.lines.find(
                (line: any) =>
                    line.currency === "USD"
            );


        
        // 4. Créer TrustLine si nécessaire
        

        if (!existingLine) {

            await submit(
                {
                    TransactionType:
                        "TrustSet",

                    Account:
                        lender.address,

                    LimitAmount: {
                        ...USD,
                        value: "100000"
                    }
                },
                lender
            );

            console.log(
                "Lender USD TrustLine created"
            );

        } else {

            console.log(
                "Lender USD TrustLine already exists"
            );
        }


        
        // 5. Lire balance lender
        

        const afterTrust: any =
            await client.request({
                command: "account_lines",

                account:
                    lender.address,

                peer:
                    issuer.address
            });

        const lenderLine =
            afterTrust.result.lines.find(
                (line: any) =>
                    line.currency === "USD"
            );

        const lenderBalance =
            Number(
                lenderLine?.balance ?? 0
            );

        console.log(
            "Current lender balance:",
            lenderBalance,
            "USD"
        );


        
        // 6. Donner 10 000 USD au lender
        //
        // Seulement ce qui manque.
        // Ça évite que chaque exécution ajoute
        // encore 10 000 USD.
        

        const TARGET_BALANCE = 10000;

        const missing =
            TARGET_BALANCE -
            lenderBalance;

        if (missing > 0) {

            await submit(
                {
                    TransactionType:
                        "Payment",

                    Account:
                        issuer.address,

                    Destination:
                        lender.address,

                    Amount: {
                        ...USD,
                        value:
                            missing.toString()
                    }
                },
                issuer
            );

            console.log(
                `${missing} test USD sent to lender`
            );

        } else {

            console.log(
                "Lender already sufficiently funded"
            );
        }


        
        // 7. Final balance
        

        const finalLines: any =
            await client.request({
                command: "account_lines",

                account:
                    lender.address,

                peer:
                    issuer.address
            });

        const finalLine =
            finalLines.result.lines.find(
                (line: any) =>
                    line.currency === "USD"
            );

        console.log(
            "\nFinal lender balance:",
            finalLine?.balance,
            "USD"
        );


        console.log(
            "\nAYZE test token ready"
        );

        console.log(
            "Default Ripple       : ON"
        );

        console.log(
            "TrustLine Locking    : ON"
        );

        console.log(
            "TokenEscrow ready    : YES"
        );

    } finally {

        if (client.isConnected()) {
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
import { Client, Wallet } from "xrpl";
import fs from "fs";

const client = new Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const accounts = JSON.parse(
    fs.readFileSync("accounts.json", "utf8")
);

const escrow = JSON.parse(
    fs.readFileSync("escrow.json", "utf8")
);


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


async function main() {

    await client.connect();

    try {

        const broker =
            Wallet.fromSeed(
                accounts.broker.seed
            );


        console.log(
            "\n=============================="
        );

        console.log(
            "     AYZE INSURANCE CLAIM"
        );

        console.log(
            "=============================="
        );

        console.log(
            "Escrow:",
            escrow.escrowID
        );

        console.log(
            "Owner:",
            escrow.owner
        );

        console.log(
            "Broker:",
            broker.address
        );

        console.log(
            "Insurance:",
            escrow.amount,
            "USD"
        );


        // ============================================
        // CHECK ESCROW STILL EXISTS
        // ============================================

        const escrowEntry: any =
            await client.request({
                command: "ledger_entry",
                index: escrow.escrowID,
                ledger_index: "validated"
            });


        console.log(
            "\nEscrow found on-chain."
        );

        console.log(
            "Condition:",
            escrowEntry.result.node.Condition
        );


        // ============================================
        // BALANCE BEFORE
        // ============================================

        const balanceBefore =
            await getUSDBalance(
                broker.address
            );


        console.log(
            "\nBroker balance before:",
            balanceBefore,
            "USD"
        );


        // ============================================
        // ESCROW FINISH
        // ============================================

        const finishTx: any = {

            TransactionType:
                "EscrowFinish",

            Account:
                broker.address,

            Owner:
                escrow.owner,

            OfferSequence:
                escrow.offerSequence,

            Condition:
                escrow.condition,

            Fulfillment:
                escrow.fulfillment
        };


        console.log(
            "\nSubmitting EscrowFinish..."
        );


        const result =
            await client.submitAndWait(
                finishTx,
                {
                    wallet: broker,
                    autofill: true
                }
            );


        const meta: any =
            result.result.meta;


        console.log(
            "EscrowFinish:",
            meta.TransactionResult
        );


        if (
            meta.TransactionResult !==
            "tesSUCCESS"
        ) {

            throw new Error(
                `EscrowFinish failed: ${meta.TransactionResult}`
            );
        }


        // ============================================
        // BALANCE AFTER
        // ============================================

        const balanceAfter =
            await getUSDBalance(
                broker.address
            );


        console.log(
            "\n=============================="
        );

        console.log(
            "      INSURANCE PAID"
        );

        console.log(
            "=============================="
        );


        console.log(
            "Broker before:",
            balanceBefore,
            "USD"
        );

        console.log(
            "Broker after:",
            balanceAfter,
            "USD"
        );

        console.log(
            "Insurance received:",
            balanceAfter - balanceBefore,
            "USD"
        );


        // ============================================
        // UPDATE JSON
        // ============================================

        escrow.status =
            "CLAIMED";

        escrow.claimedAt =
            new Date().toISOString();

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


        console.log(
            "\nescrow.json updated"
        );


        console.log(
            "\nINSURER -> ESCROW -> BROKER"
        );

        console.log(
            "Insurance claim complete."
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
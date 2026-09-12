import * as xrpl from "xrpl";
import fs from "fs";

const client = new xrpl.Client(
    "wss://lending-hackathon.dev.ripplex.io:51233"
);

const accounts = JSON.parse(
    fs.readFileSync("accounts.json", "utf8")
);

const vaultData = JSON.parse(
    fs.readFileSync("vault.json", "utf8")
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

async function getMPTBalance(
    address: string,
    mptIssuanceID: string
): Promise<string> {
    try {
        const response: any =
            await client.request({
                command: "ledger_entry",
                ledger_index: "validated",
                mptoken: {
                    mpt_issuance_id:
                        mptIssuanceID,
                    account:
                        address
                }
            } as any);

        return (
            response.result.node
                ?.MPTAmount ?? "0"
        );

    } catch (err: any) {
        if (
            err?.data?.error ===
            "entryNotFound"
        ) {
            return "0";
        }

        throw err;
    }
}

async function main() {
    await client.connect();

    try {
        const lender =
            xrpl.Wallet.fromSeed(
                accounts.lender.seed
            );

        console.log(
            "\n=============================="
        );
        console.log(
            "    AYZE TRACK 1 WITHDRAW"
        );
        console.log(
            "=============================="
        );

        console.log(
            "Lender:",
            lender.address
        );

        console.log(
            "Vault:",
            vaultData.vaultID
        );

        // Track 1:
        // redeem all lender vault shares at the CURRENT PPS.
        // This is what demonstrates principal + accrued yield.
        const sharesBefore =
            await getMPTBalance(
                lender.address,
                vaultData.shareMPTID
            );

        if (
            BigInt(sharesBefore) <= 0n
        ) {
            throw new Error(
                "Lender has no vault shares to redeem."
            );
        }

        const usdBefore =
            await getUSDBalance(
                lender.address
            );

        console.log(
            "Vault shares before:",
            sharesBefore
        );

        console.log(
            "USD before:",
            usdBefore
        );

        const tx: any = {
            TransactionType:
                "VaultWithdraw",

            Account:
                lender.address,

            VaultID:
                vaultData.vaultID,

            // Specifying vault SHARES means:
            // burn these shares and receive the
            // corresponding amount of vault assets.
            Amount: {
                mpt_issuance_id:
                    vaultData.shareMPTID,
                value:
                    sharesBefore
            },

            Destination:
                lender.address
        };

        xrpl.validate(tx);

        console.log(
            "\nRedeeming all vault shares..."
        );

        const result: any =
            await client.submitAndWait(
                tx,
                {
                    wallet: lender,
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
            "VaultWithdraw:",
            meta.TransactionResult
        );

        if (
            meta.TransactionResult ===
            "tecINSUFFICIENT_FUNDS"
        ) {
            throw new Error(
                "Vault does not currently have enough liquid assets. Repay/close the loan before the final Track 1 withdrawal."
            );
        }

        if (
            meta.TransactionResult !==
            "tesSUCCESS"
        ) {
            throw new Error(
                `VaultWithdraw failed: ${meta.TransactionResult}`
            );
        }

        const usdAfter =
            await getUSDBalance(
                lender.address
            );

        const sharesAfter =
            await getMPTBalance(
                lender.address,
                vaultData.shareMPTID
            );

        console.log(
            "\n=============================="
        );
        console.log(
            "       WITHDRAW SUCCESS"
        );
        console.log(
            "=============================="
        );

        console.log(
            "USD after:",
            usdAfter
        );

        console.log(
            "Assets received:",
            usdAfter - usdBefore,
            "USD"
        );

        console.log(
            "Vault shares after:",
            sharesAfter
        );

        console.log(
            "\nTrack 1 requirement:"
        );
        console.log(
            "capital + accrued yield redeemed at current PPS."
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

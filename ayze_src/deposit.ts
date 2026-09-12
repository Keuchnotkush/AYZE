import { Client, Wallet } from "xrpl";
import fs from "fs";

const client = new Client("wss://lending-hackathon.dev.ripplex.io:51233");

const accounts = JSON.parse(
    fs.readFileSync("accounts.json", "utf8")
);

const vault = JSON.parse(
    fs.readFileSync("vault.json", "utf8")
);

async function main() {
    await client.connect();

    const lender = Wallet.fromSeed(accounts.lender.seed);

    console.log("Lender:", lender.address);
    console.log("Vault:", vault.vaultID);
    console.log("\nDepositing 5,000 test RLUSD...");

    const deposit = {
        TransactionType: "VaultDeposit" as const,
        Account: lender.address,
        VaultID: vault.vaultID,
        Amount: {
            currency: "USD",
            issuer: accounts.issuer.address,
            value: "5000"
        }
    };

    const result = await client.submitAndWait(deposit, {
        wallet: lender,
        autofill: true
    });

    console.log(
        "Result:",
        typeof result.result.meta === "object"
            ? result.result.meta.TransactionResult
            : result.result.meta
    );

    console.log("\n5,000 test RLUSD deposited into AYZE Vault");

    await client.disconnect();
}

main();
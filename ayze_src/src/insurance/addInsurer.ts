import { Client } from "xrpl";
import fs from "fs";

const client = new Client("wss://lending-hackathon.dev.ripplex.io:51233");

async function main() {
  await client.connect();

  const accounts = JSON.parse(fs.readFileSync("state/accounts.json", "utf8"));

  if (accounts.insurer) {
    console.log("INSURER already exists:", accounts.insurer.address);
    await client.disconnect();
    return;
  }

  const { wallet } = await client.fundWallet();

  accounts.insurer = {
    address: wallet.address,
    seed: wallet.seed,
  };

  fs.writeFileSync("state/accounts.json", JSON.stringify(accounts, null, 2));

  console.log("INSURER created:", wallet.address);

  await client.disconnect();
}

main().catch(console.error);


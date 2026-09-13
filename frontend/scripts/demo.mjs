// End-to-end marketplace scenario against the running dashboard (real devnet transactions).
// Usage: node scripts/demo.mjs [--base http://localhost:3000] [--stamp <existing run>] [--from <step>]
// Steps: register, vault, deposit, borrow, accredit, guarantee, pay, rbac, default, close, balances
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? "playwright");

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : [])).filter((e) => e.length));
const base = args.base ?? "http://localhost:3000";
const stamp = args.stamp ?? Date.now().toString(36);
const from = args.from ?? "register";
const STEPS = ["register", "vault", "deposit", "borrow", "accredit", "guarantee", "pay", "rbac", "default", "close", "balances"];
const active = new Set(STEPS.slice(STEPS.indexOf(from)));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const email = (role) => `${role}-${stamp}@ayze.demo`;
const HOME = { broker: "/broker", lender: "/market", borrower: "/borrower", "protection-seller": "/protect" };
/* Lender and protection seller are wallet-only: their seeds are generated on first run and kept
   next to the script so a later `--from <step>` can reconnect them. */
const WALLET_ROLES = ["lender", "protection-seller"];
const SEEDS_FILE = new URL(`./.demo-${stamp}.json`, import.meta.url);
const seeds = fs.existsSync(SEEDS_FILE) ? JSON.parse(fs.readFileSync(SEEDS_FILE, "utf8")) : {};

async function login(role) {
  await page.context().clearCookies();
  await page.goto(base + "/login");
  if (WALLET_ROLES.includes(role)) {
    await page.getByRole("tab", { name: "Connect wallet" }).click();
    await page.click(`input[name=role][value="${role}"]`, { force: true });
    await page.fill("input[name=seed]", seeds[role]);
    await page.getByRole("button", { name: "Connect wallet" }).click();
  } else {
    await page.fill("input[name=email]", email(role));
    await page.fill("input[name=password]", "demo1234");
    await page.click("button[type=submit]");
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
}

async function register(role, company) {
  await page.context().clearCookies();
  await page.goto(base + "/login");
  if (WALLET_ROLES.includes(role)) {
    await page.getByRole("tab", { name: "Connect wallet" }).click();
    await page.click(`input[name=role][value="${role}"]`, { force: true });
    await page.getByRole("button", { name: "Generate wallet" }).click();
    const seed = (await page.locator("code", { hasText: /^s/ }).first().innerText({ timeout: 180000 })).trim();
    seeds[role] = seed;
    fs.writeFileSync(SEEDS_FILE, JSON.stringify(seeds, null, 2));
    await page.getByRole("link", { name: "Continue to dashboard" }).click();
  } else {
    await page.getByRole("tab", { name: "Create account" }).click();
    await page.fill("input[name=company]", company);
    await page.fill("input[name=email]", email(role));
    await page.fill("input[name=password]", "demo1234");
    await page.click(`input[name=role][value="${role}"]`, { force: true });
    await page.click("button[type=submit]");
  }
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 });
  log("registered", role, "→", page.url());
}

/** Full r-address of the logged-in user, from the header's explorer link. */
const myAddress = () => page.locator("header a[title^='r']").first().getAttribute("title");

async function submitAndRead(form, timeout = 300000) {
  await form.locator("button[type=submit]").click();
  const status = form.locator("[role=status]");
  await status.waitFor({ timeout });
  return (await status.innerText()).replace(/\s+/g, " ").trim();
}

const vaultName = "Working capital " + stamp;

if (active.has("register")) {
  await register("broker", "Broker & Co");
  await register("lender", "Lender Capital");
  await register("borrower", "Borrower SAS");
  await register("protection-seller", "Protect Re");
}

if (active.has("vault")) {
  await login("broker");
  const form = page.locator("form", { has: page.locator("input[name=name]") });
  await form.locator("input[name=name]").fill(vaultName);
  await form.locator("input[name=description]").fill("Demo vault");
  await form.locator("input[name=firstLoss]").fill("2100");
  log("create vault:", await submitAndRead(form));
}

if (active.has("deposit")) {
  await login("lender");
  await page.goto(base + "/market");
  const card = page.locator("[data-slot=card]", { hasText: vaultName });
  const form = card.locator("form", { has: page.locator('input[name=amount][placeholder="1000"]') });
  await form.locator("input[name=amount]").fill("2500");
  log("deposit:", await submitAndRead(form));
}

if (active.has("borrow")) {
  await login("borrower");
  await page.goto(base + "/market");
  const card = page.locator("[data-slot=card]", { hasText: vaultName });
  // Per-vault verification first: AYZE_KYC + VAULT_<id> credentials (CredentialCreate + CredentialAccept ×2).
  const verify = card.locator("form", { hasText: "Be verified" });
  if (await verify.count()) {
    // On success the page revalidates and the verify form unmounts: accept the status box or the Verified badge.
    await verify.locator("button[type=submit]").click();
    const status = verify.locator("[role=status]");
    const badge = card.getByText("Verified", { exact: true });
    await Promise.race([status.waitFor({ timeout: 300000 }), badge.waitFor({ timeout: 300000 })]);
    log("verify:", (await status.count()) ? (await status.innerText()).replace(/\s+/g, " ").trim() : "Verified badge shown (AYZE_KYC + VAULT credentials accepted)");
  }
  const form = card.locator("form", { has: page.locator("input[name=paymentTotal]") });
  await form.locator("input[name=paymentTotal]").fill("3");
  await form.locator("input[name=paymentInterval]").fill("120");
  log("borrow:", await submitAndRead(form));
}

if (active.has("accredit")) {
  await login("protection-seller");
  const sellerAddress = await myAddress();
  await login("broker");
  await page.goto(base + "/broker");
  await page.locator("a[href^='/broker/vaults/']").first().click();
  await page.waitForURL("**/broker/vaults/**");
  const issue = page.locator("form", { has: page.locator("input[name=address]") });
  await issue.locator("input[name=address]").fill(sellerAddress);
  log("accredit (broker):", await submitAndRead(issue));
  await login("protection-seller");
  await page.goto(base + "/protect");
  const accept = page.locator("form", { hasText: "Accept accreditation" }).first();
  log("accredit (seller accepts):", await submitAndRead(accept));
}

if (active.has("guarantee")) {
  await login("protection-seller");
  await page.goto(base + "/protect");
  const form = page.locator("form", { hasText: "Guarantee" }).first();
  // The action revalidates /protect: the loan moves to "My guarantees" and the form unmounts,
  // so accept either the form status or the updated "Locked" stat as the outcome.
  await form.locator("button[type=submit]").click();
  const status = form.locator("[role=status]");
  const locked = page.locator("main", { hasText: /[1-9]\d* loans protected/ });
  await Promise.race([status.waitFor({ timeout: 300000 }), locked.waitFor({ timeout: 300000 })]);
  const text = (await status.count()) ? await status.innerText() : (await page.locator("main").innerText()).match(/LOCKED\s+[\d,.]+ XRP\s+\d+ loans protected/)?.[0];
  log("guarantee:", (text ?? "").replace(/\s+/g, " ").trim());
}

if (active.has("pay")) {
  await login("borrower");
  await page.goto(base + "/borrower");
  const form = page.locator("form", { hasText: "Pay instalment" }).first();
  log("pay #1:", await submitAndRead(form));
}

if (active.has("rbac")) {
  await login("lender");
  await page.goto(base + "/borrower");
  log("lender on /borrower →", (await page.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 140));
}

if (active.has("default")) {
  await login("broker");
  await page.goto(base + "/broker");
  await page.locator("a[href^='/broker/vaults/']").first().click();
  await page.waitForURL("**/broker/vaults/**");
  if ((await page.locator("main").innerText()).includes("Repaid")) {
    log("default: loan already repaid by auto-debit; run the container with AYZE_AUTODEBIT=off to demo a default");
  } else {
  let form = page.locator("form", { hasText: "Declare default" }).first();
  log("default (early):", await submitAndRead(form));
  for (let i = 0; i < 60; i++) {
    await page.reload();
    if ((await page.locator("main").innerText()).includes("In default window")) break;
    await page.waitForTimeout(10000);
  }
  form = page.locator("form", { hasText: "Declare default" }).first();
  log("default (after grace):", await submitAndRead(form));
  }
}

if (active.has("close")) {
  await login("broker");
  await page.goto(base + "/broker");
  await page.locator("a[href^='/broker/vaults/']").first().click();
  await page.waitForURL("**/broker/vaults/**");
  const form = page.locator("form", { hasText: "Close loan" }).first();
  log("close:", await submitAndRead(form));
}

if (active.has("balances")) {
  for (const role of Object.keys(HOME)) {
    await login(role);
    await page.goto(base + HOME[role]);
    const m = (await page.locator("main").innerText()).match(/WALLET\s+([\d,.]+ XRP)/);
    log(role.padEnd(18), "wallet:", m?.[1]);
  }
}

await browser.close();
log("done, stamp =", stamp);

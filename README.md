# AYZE

Short-term financing assured on the XRP Ledger.
XLS-65 (Single Asset Vault) + XLS-66 (Lending Protocol) + XLS-85 (TokenEscrow).

**Track 1 — open-ended vault — flavour Loaded.**

## The idea

A lender financing a business never loses more than **10% of their claim**, because two actors absorb 90% before them.



<img src="assets/flow.png" alt="drawing" width="500"/>

The broker deposits 90% of the debt as first-loss. On default, the ledger automatically pays that 90% to the vault. The insurer then reimburses 30% to the broker via the escrow ladder, bringing their net loss down to 60%. It's a CDS, with the broker as protection buyer.

## Prerequisites

```bash
npm install
```

**Network** 

`src/config.ts` holds the endpoint.

```bash
export XRPL_WSS="wss://lending-hackathon.dev.ripplex.io:51233"
export XRPL_EXPLORER="https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233"
```

**Stablecoin.** RLUSD only exists on Testnet, not on Devnet.


| # | Requirement | Script
|---|---|---|
| 01 | Open-ended vault | `tofill` |
| 02 | Lender deposit | `tofill` |
| 03 | Broker loan + accepted loan | `tofill` |
| 04 | Drawdown + one repayment | `tofill` |
| 05 | Capital + yield withdrawal | `tofill` |
| 06 | Transaction refused by a guardrail | `tofill` |






## Structure

```
src/
```
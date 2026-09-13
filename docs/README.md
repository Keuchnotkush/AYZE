# AYZE documentation

Map of the documentation. Everything described here matches the code in `frontend/src/server/`
(dashboard, M1/M2) and, for history, the `ayze_src/` scripts (M0). Diagrams are Mermaid: they
render directly on GitHub and in VS Code.

```
docs/
├── README.md                        ← this file
├── architecture/
│   ├── 01-overview.md               big picture: actors, layers, ledger objects, registry
│   └── 02-registration-and-loan.md  general roadmap: registration → vault → deposit → KYC → loan
│                                    → guarantee → servicing → default / repayment → close
├── roles/                           one access-and-usage roadmap per role
│   ├── README.md                    RBAC matrix, routes, navigation
│   ├── broker.md
│   ├── lender.md
│   ├── borrower.md
│   ├── protection-seller.md
│   └── platform.md                  AYZE, the implicit actor (platform wallet)
├── amendments/                      one folder per XRPL amendment in use
│   ├── README.md                    matrix amendment → transaction → function → file
│   │                                (also covers native Escrow and Payment)
│   ├── xls65/                       Single Asset Vault
│   ├── xls66/                       Lending Protocol
│   └── xls70/                       Credentials (stand-in for KYC, no provider)
├── specs/
│   └── 2026-09-12-marketplace-v1-design.md   marketplace V1 design
└── assets/
    └── flow.png
```

## Where to start

| You want to… | Read |
|---|---|
| understand AYZE in one diagram | [`architecture/01-overview.md`](architecture/01-overview.md) |
| follow a loan from registration to close | [`architecture/02-registration-and-loan.md`](architecture/02-registration-and-loan.md) |
| know what a role can do and how it signs in | [`roles/`](roles/README.md) |
| find which function submits which transaction | [`amendments/README.md`](amendments/README.md) |
| the XLS-66 spec constraints that drive the design | [`amendments/xls66/`](amendments/xls66/README.md) and `../ROADMAP.md` |

## Network

Lending-hackathon devnet: `wss://lending-hackathon.dev.ripplex.io:51233`
Explorer: `https://custom.xrpl.org/lending-hackathon.dev.ripplex.io:51233`
Asset: **native XRP** only (no issuer, no trust line, no IOU since the 2026-09-13 migration).

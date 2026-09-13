# AYZE Marketplace V1 — design

Date : 2026-09-12 · Statut : à valider

## 1. Objectif

Remplacer la démo "un vault / un prêt / un ladder" par une **marketplace de vaults** où quatre rôles
se rencontrent, avec un RBAC fixe, un KYC simulé par credential XLS-70, et le modèle économique
AYZE (6 % d'intérêt réparti 50/30/20, commission AYZE 0,5 %, perte répartie 30/40/30) exprimé
en **bps entiers**. Cette version est le socle : rien n'est optimisé tant qu'elle ne tourne pas
de bout en bout sur le devnet hackathon.

Hors périmètre V1 : approbation manuelle des prêts, garantie au niveau du vault, multi-rôle,
transactions Batch, vrai auth (mots de passe hashés mais aucune récupération, pas de sessions
expirables), wallet utilisateur non custodial.

## 2. Acteurs et RBAC

| Rôle | Voit | Peut | Wallet |
|---|---|---|---|
| **Broker** | ses vaults, les prêts sortis de chacun | créer un vault, déclarer un défaut, claim l'assurance | custodial |
| **Lender** | tous les vaults (marketplace) | déposer / retirer sur un vault | wallet-only |
| **Borrower** | tous les vaults avec ≥ 1 000 XRP disponibles | se faire vérifier par vault, emprunter (ticket fixe), payer une échéance, rembourser | custodial + credentials `AYZE_KYC` et `VAULT_<id>` |
| **Protection seller** | les prêts sans garant | garantir un prêt | wallet-only |
| AYZE (plateforme) | — | émet le credential `AYZE_KYC`, encaisse 0,5 % par prêt, signe les `EscrowCancel` | `platform.json` |

L'actif est le **XRP natif** : pas d'issuer, pas de trust line, pas d'IOU. Les comptes démo sont fundés en XRP depuis le genesis du devnet.

RBAC **fixe** : un rôle par compte, une action hors rôle est refusée **avant** toute transaction
avec le code `AYZE_FORBIDDEN_ROLE`. Pas de permissions fines.

### Codes d'erreur applicatifs

| Code | Quand |
|---|---|
| `AYZE_FORBIDDEN_ROLE` | action hors rôle |
| `AYZE_KYC_REQUIRED` | borrow sans credential valide sur le ledger |
| `AYZE_INSUFFICIENT_LIQUIDITY` | vault `AssetsAvailable` < 1 000 |
| `AYZE_BROKER_COVER_INSUFFICIENT` | le broker n'a pas 700 XRP pour le first-loss du prêt |
| `AYZE_INSUFFICIENT_FUNDS` | XRP dépensable (solde − réserve) insuffisant pour l'action (dépôt, échéance, garantie) |
| `AYZE_ALREADY_GUARANTEED` | un PS tente de garantir un prêt déjà garanti |
| `AYZE_LOAN_NOT_DEFAULTED` | claim d'escrow sur un prêt non défaillant |
| `AYZE_INVALID_TERMS` | échéances/intervalle hors bornes ledger (voir §4.3) |
| `XRPL_<tec…>` | rejet ledger, code transmis tel quel (`XRPL_tecTOO_SOON`…) |

Les erreurs sont des données (`ActionResult { ok:false, code, message }`), jamais des exceptions
non rattrapées vers l'UI.

## 3. Modèle économique (bps entiers)

Toutes les constantes sont des entiers dans `protocol/economics.ts` ; les montants sont calculés
en **drops (bigint, 1 XRP = 1 000 000 drops)** puis sérialisés en chaîne de drops pour le ledger, jamais en float.
L'UI affiche le solde brut du compte (`account_info.Balance`), comme l'explorer ; les contrôles utilisent le solde dépensable (solde − réserve).

| Constante | Valeur | Unité |
|---|---|---|
| `TICKET` | 1 000 XRP (1 000 000 000 drops) | fixe en V1 |
| `INTEREST_BPS` | 600 | 6 % du principal, flat sur la durée du prêt |
| `INTEREST_SPLIT_BPS` | PS 5 000 · Broker 3 000 · Lender 2 000 | part de l'intérêt (somme 10 000) |
| `AYZE_FEE_BPS` | 50 | 0,5 % du principal, en plus des intérêts |
| `FIRST_LOSS_BPS` | 7 000 | cover broker = 70 % du principal |
| `PROTECTION_BPS` | 4 000 | escrows PS = 40 % du principal |
| Perte résiduelle lender | 3 000 | 30 %, implicite (100 − 70) |

**Exemple sur 1 000 XRP, 4 échéances** : intérêt 60 XRP → PS 30, broker 18, lenders 12 ;
AYZE 5 XRP à l'origination. Chaque échéance = 250 de principal + 15 d'intérêt (7,50 / 4,50 / 3,00).

**Défaut à l'échéance k** (principal restant R) : ledger → vault `min(0,7 R, R, cover)` = 0,7 R ;
broker claim les escrows k..N = 0,4 R ; bilan broker −0,3 R, PS −0,4 R, lenders −0,3 R.

**Hypothèse à confirmer** : si aucun PS n'a garanti le prêt, la part PS de l'intérêt va au broker
(il porte seul les 70 %). Alternative : ne pas la facturer au borrower.

## 4. Mapping règle métier → ledger

### 4.1 Contraintes XLS-66 qui dictent le mapping

| Contrainte (spec XLS-66) | Conséquence |
|---|---|
| `ManagementFeeRate` ≤ 10 000 (10 % des intérêts) | le split 50/30/20 ne peut pas être on-chain |
| `InterestRate` annualisé, ≤ 100 %/an | sur un prêt de quelques minutes l'intérêt on-chain ≈ 0 → les 6 % flat sont des `Payment` orchestrés par l'app |
| `DefaultCovered = min(DebtTotal × CoverRateMinimum × CoverRateLiquidation, DefaultAmount, CoverAvailable)` avec `DebtTotal` **du LoanBroker** | pour un 70 % exact par prêt : **un LoanBroker par prêt** (`DebtMaximum` = ticket) |
| `PaymentInterval` ≥ 60 s, `GracePeriod` ∈ [60 s, `PaymentInterval`] | bornes de l'UI borrower |
| Le pseudo-compte du vault n'est pas payable par `Payment` (non prévu par la spec, à confirmer sur le devnet) | la part lender de l'intérêt est versée **directement aux lenders**, au prorata de leurs parts au moment du paiement |
| Owner du LoanBroker = owner du Vault (contrôle présent dans `broker.ts`, à confirmer dans la spec) | le **broker** crée le vault et chaque LoanBroker |

### 4.2 Création de compte (tous rôles)

**Broker / borrower (custodial)** : email + mot de passe (`scrypt`), seed du wallet dans `registry.json`.
**Lender / protection seller (wallet-only)** : pas d'email/mot de passe ; « Connect wallet » colle une seed
existante ou en génère une (funded comme ci-dessous). La seed n'est **jamais** écrite dans `registry.json` —
uniquement chiffrée (AES-256-GCM, clé dérivée de `SESSION_SECRET`) dans le cookie de session ; `logout` l'efface.

1. `Wallet.generate()` ; `Payment` 10 000 XRP depuis le genesis du devnet (argent de démo, `DEMO_XRP`). Plus de
   `TrustSet` ni d'issuer : l'actif est le XRP natif.
3. Aucun credential à l'inscription. Le borrower se fait vérifier **par vault** (bouton « Be verified »,
   `credentials.ts`) : `CredentialCreate` par AYZE (hex(`AYZE_KYC`), une fois par borrower) et par le
   broker du vault (hex(`VAULT_<16 premiers hex du vaultID>`)), chacun suivi d'un `CredentialAccept`
   du borrower. Relus sur le ledger (`ledger_entry` type `credential`) à chaque borrow, repli registre
   (`Vault.verifiedBorrowers`, `User.credentials`) si le RPC échoue.
4. Enregistrement dans le registre (§5) avec mot de passe hashé (`scrypt`).

### 4.3 Broker : créer un vault

Entrée : nom, description, **first-loss capital** (XRP, obligatoire, > 0 ; contrôle XRP dépensable du broker ≥ montant).
Séquence ledger (séquentielle, arrêt au premier échec, code XRPL remonté) : 1. `VaultCreate` (Account = broker,
Asset = `{ currency: "XRP" }` (XLS-65), `WithdrawalPolicy` first-come, public, sans `Scale` — implicite 6 pour XRP) → 2. `LoanBrokerSet` sur ce vault
(`ManagementFeeRate` 0, `CoverRateMinimum` 70 000, `CoverRateLiquidation` 100 000, `DebtMaximum` 0 = illimité)
→ 3. `LoanBrokerCoverDeposit` du first-loss. Registre : `{ vaultID, loanBrokerID, firstLoss, brokerId, name, description }`.
Le vault est visible dans la marketplace dès que `AssetsAvailable` > 0 (borrower) ou immédiatement (lender).

### 4.4 Lender : déposer / retirer

`VaultDeposit` / `VaultWithdraw` (parts MPT ou montant en drops), identiques à aujourd'hui, sur le vault
choisi. Le registre note le dépôt (`{ vaultID, lenderId }`) pour retrouver les lenders d'un vault
lors de la distribution d'intérêts ; les proportions viennent du ledger (`MPTAmount`).

### 4.5 Borrower : emprunter (automatique)

Entrée : vault, `paymentTotal` N (1..12), `paymentInterval` s (≥ 60). `GracePeriod` = `DEFAULT_GRACE`
= ceil(10 % × N × interval), borné à [60 s, interval] (registre `graceSeconds`).

Contrôles applicatifs, dans l'ordre, chacun avec son code : rôle → credentials `AYZE_KYC` + `VAULT_<id>` on-chain (`AYZE_KYC_REQUIRED`) → liquidité
du vault → `CoverAvailable` du LoanBroker du vault (ledger, repli registre `firstLoss`) ≥ 70 % de
(`DebtTotal` + 1 000), soit 700 XRP par prêt ouvert → `AYZE_BROKER_COVER_INSUFFICIENT` sinon → bornes des termes.

Séquence ledger (signées côté serveur, séquentielles, arrêt au premier échec). Le LoanBroker est
celui du vault (`vault.loanBrokerID`, créé en §4.3) : plus de `LoanBrokerSet` / `CoverDeposit` par prêt.

| # | Tx | Signataire | Paramètres |
|---|---|---|---|
| 1 | `LoanSet` | broker + contre-signature borrower (`signLoanSetByCounterparty`) | `LoanBrokerID` du vault, `PrincipalRequested` 1 000 XRP (en drops), `InterestRate` 0, fees 0, `PaymentTotal` N, `PaymentInterval`, `GracePeriod` |
| 2 | `Payment` | borrower → AYZE | 5 XRP (commission 0,5 %) |

Registre : `loan { loanID, loanBrokerID, vaultID, borrowerId, N, interval, grace, schedule[], status:"active", guarantee:null }`.
Le `schedule[]` (dates d'échéance ripple-epoch, principal et intérêt par échéance en drops) est
calculé une fois à l'origination et sert aux escrows et aux paiements.

Si la tx 2 échoue, le prêt existe et la commission est réessayée ; l'UI affiche le code.
"Close" (§4.7/4.8) ne fait plus que `LoanDelete` : le LoanBroker du vault et sa cover restent pour les prêts suivants.

### 4.6 Protection seller : garantir un prêt

Liste : prêts `active` sans `guarantee`. Action sur un prêt :

- Contrôles : rôle, prêt non garanti, XRP dépensable du PS ≥ 400 (+ réserve d'un objet par escrow).
- Pour chaque échéance i restante : `EscrowCreate` **XRP natif** PS → broker, montant `0,4 × principal_i` en drops
  (l'escrow de token XLS-85 / `asfAllowTrustLineLocking` n'est plus nécessaire),
  `Condition` = SHA-256 d'un preimage aléatoire (fulfillment gardé dans le registre, côté serveur),
  `CancelAfter` = `due_i + DEFAULT_GRACE + CLAIM_WINDOW` (300 s).
- Registre : `guarantee { psId, escrows[{ i, escrowID, offerSequence, condition, fulfillment, cancelAfter, status }] }`.

En cas de défaut à k, les escrows k..N sont encore verrouillés et claimables par le broker. Un escrow
d'échéance payée (ou de prêt remboursé/clos) est libéré par la boucle de servicing dès `CancelAfter` :
`EscrowCancel` signé par le compte plateforme (`Owner` = PS, `OfferSequence`) → `status:"RELEASED"`, fonds au PS.

### 4.7 Borrower : payer une échéance / rembourser

Servicing automatique (`servicing.ts`, toutes les 15 s + `POST /api/servicing/run`) : à `due_i`,
l'échéance est débitée du wallet custodial du borrower (même séquence que ci-dessous) ; l'échec
(`lastAttemptError`, ex. `AYZE_INSUFFICIENT_FUNDS`) est affiché « Late » et réessayé à chaque passe.

"Pay instalment" (échéance i, montant = `principal_i` + intérêt `interest_i`, aussi manuel) :

| # | Tx | Flux |
|---|---|---|
| 1 | `LoanPay` | borrower → loan, `principal_i` (+ late fee 0 en V1 ; le retard est visible via `NextPaymentDueDate`) |
| 2 | `Payment` | borrower → PS, `interest_i × 50 %` (ou → broker si pas de PS, cf. hypothèse §3) |
| 3 | `Payment` | borrower → broker, `interest_i × 30 %` |
| 4..n | `Payment` | borrower → chaque lender du vault, `interest_i × 20 %` au prorata des parts (reste d'arrondi au plus gros porteur) |

"Repay in full" : `LoanPay` du `TotalValueOutstanding` + les `Payment` d'intérêt des échéances
restantes. À la dernière échéance le ledger supprime le Loan ; le registre passe `status:"repaid"`
et le broker peut `LoanBrokerCoverWithdraw` (700) puis `LoanBrokerDelete` (bouton "Close" côté
broker, V1 inclus car sinon le cover reste bloqué).

### 4.8 Broker : défaut et assurance

- Auto-défaut : si une échéance reste impayée après `due + DEFAULT_GRACE` (10 % de la durée), la boucle
  soumet `LoanManage` `tfLoanDefault` (broker) puis le claim ; registre `defaultedBy:"auto"`.
- "Declare default" (manuel) : même `LoanManage` signé par le broker. Avant `due + grace` le
  ledger répond `tecTOO_SOON` → affiché tel quel (guardrail). Après : `status:"defaulted"`, le
  cover part au vault.
- "Claim insurance" : pour chaque escrow encore `LOCKED` dont l'échéance ≥ k : `EscrowFinish`
  par le broker avec le fulfillment du registre. Refusé avec `AYZE_LOAN_NOT_DEFAULTED` sinon.
- Après claim : `LoanBrokerCoverWithdraw` du reliquat + `LoanBrokerDelete` (bouton "Close").

## 5. Registre applicatif

Un fichier JSON `frontend/data/registry.json` (git-ignoré), accédé via `protocol/registry.ts`
(lecture → mutation → écriture atomique par renommage ; un seul process Next). Suffisant pour
la démo ; le module expose `get/list/insert/update` typés pour pouvoir passer à SQLite sans
toucher aux actions.

```ts
type User = { id; email; passwordHash; company; role: RoleId; wallet: { address; seed }; credential?: { issuer; type; accepted: true } }
type Vault = { id; vaultID; brokerId; name; description; createdAt }
type Deposit = { vaultID; lenderId }                     // appartenance, les montants viennent du ledger
type Loan = { id; loanID; loanBrokerID; vaultID; borrowerId; principal; paymentTotal; paymentInterval; gracePeriod;
              schedule: { index; dueDate; principal; interest }[]; status: "active"|"repaid"|"defaulted"|"closed";
              guarantee?: { psId; escrows: Escrow[] }; createdAt }
type Escrow = { index; escrowID; offerSequence; condition; fulfillment; cancelAfter; status: "LOCKED"|"CLAIMED"|"EXPIRED" }
```

`platform.json` (AYZE seul, créé au premier usage) vit dans `ayze_src/` à côté des
scripts existants, qui restent inchangés (livrable hackathon).

Le ledger reste la source de vérité pour tous les **montants** (vault, cover, loan, escrows,
balances) ; le registre ne porte que le **matching** (qui possède / a garanti / a déposé où) et
les secrets (seeds, fulfillments).

## 6. Écrans

Toutes les pages sont des Server Components lisant registre + ledger au rendu ; chaque action est
une Server Action qui renvoie `ActionResult` et `revalidatePath`.

| Route | Rôle | Contenu |
|---|---|---|
| `/register` | — | company, email, mot de passe, rôle → création de compte (§4.2), puis dashboard |
| `/login` | — | email + mot de passe |
| `/dashboard` | tous | redirige vers la vue du rôle |
| `/broker` | broker | mes vaults (liquidité, prêts actifs/défaillants) + "Create vault" |
| `/broker/vaults/[id]` | broker | prêts de ce vault : statut, échéance, cover, garant ; actions Declare default / Claim / Close |
| `/market` | lender, borrower | tous les vaults : broker, liquidité, nb de prêts, (lender) ma position ; boutons Deposit/Withdraw ou Borrow |
| `/borrower` | borrower | mes prêts : prochaine échéance, Pay instalment, Repay in full |
| `/protect` | PS | prêts sans garant (vault, broker, montant à bloquer 400, prime 30) ; mes garanties avec l'état des escrows |

Composants existants réutilisés : `Stat`, `Card`, `Badge`, `TxForm`, `TxButton`, `Address`,
`EscrowTable`, `LoanStatusBadge`. Nouveaux : `VaultCard`, `LoanRow`, `RegisterForm`.

## 7. Structure du code

```
frontend/src/server/
  protocol/
    economics.ts    constantes bps, split d'une échéance, schedule (pur, testé)
    amounts.ts      drops bigint ↔ chaîne XRPL / affichage XRP (pur, testé)
    registry.ts     accès au registre JSON
    accounts.ts     création de compte, credential
    vaults.ts       VaultCreate, deposit, withdraw, lecture vault
    loans.ts        borrow (séquence §4.5), pay, repay, default, close, lecture loan
    guarantees.ts   escrows (create / claim / expiry)
    ledger.ts       lectures génériques (existant, étendu : credential, escrows par owner)
    xrpl.ts         client + submit (existant)
  auth/
    session.ts      cookie userId, requireRole(role) → AYZE_FORBIDDEN_ROLE
    password.ts     scrypt
  actions/          une Server Action par cas d'usage, mince : auth → protocol → ActionResult
```

`ayze_src/` conserve les scripts ; `platform.json` y est ajouté. Le code XRPL de `frontend/src/server`
d'aujourd'hui (single-vault) est remplacé par `protocol/`.

## 8. Tests

- **Unitaires** (vitest) : `economics.ts` (splits bps, somme des parts = intérêt, reste d'arrondi,
  schedule aux bornes), `amounts.ts` (round-trip bigint ↔ XRPL string, 15 chiffres significatifs).
- **Scénario e2e** (script Playwright `frontend/scripts/demo.mjs`, devnet réel) : register 4 comptes →
  broker crée un vault → lender dépose 5 000 → borrower emprunte (3 × 90 s, grace 60 s) → PS garantit
  → borrower paie l'échéance 1 (vérifie les 4 Payment d'intérêt) → échéance 2 manquée → default
  `tecTOO_SOON` puis succès → claim escrows 2-3 → bilans : lender −30 %, PS −40 %, broker −30 % du
  principal restant. Le script imprime les liens explorateur de chaque tx.
- Les erreurs RBAC : test unitaire de `requireRole` + un cas e2e (lender qui POST l'action borrow → `AYZE_FORBIDDEN_ROLE`).

## 9. Décisions prises et alternatives écartées

| Décision | Pourquoi | Écarté |
|---|---|---|
| Un LoanBroker par prêt | seul moyen d'avoir 70 % exact avec la formule broker-wide | un LoanBroker par vault (cover d'un prêt pourrait éponger 100 % d'un autre) |
| Intérêt 100 % off-chain via `Payment` | rate annualisé + plafond 10 % du mgmt fee + pseudo-compte non payable | `InterestRate` on-chain (≈ 0 sur une démo de minutes) |
| Escrow par échéance | rend exactement 40 % du principal **restant** ; les échéances payées reviennent au PS | un seul escrow de 400 (sur-indemnise le broker) |
| Credential XLS-70 réel, RBAC applicatif | le KYC est prouvable on-chain, le wallet AYZE a un rôle concret | flag KYC dans le registre |
| Registre JSON | zéro infra, un process | SQLite (à faire si multi-process / persistance durable) |
| Ticket fixe 1 000, termes libres dans les bornes ledger | demande explicite | montant libre |

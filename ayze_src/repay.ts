import {
    Client,
    Wallet,
    validate
} from "xrpl";

import fs from "fs";


// ==================================================
// NETWORK
// ==================================================

const WSS =
    "wss://lending-hackathon.dev.ripplex.io:51233";

const client =
    new Client(WSS);


// ==================================================
// DATA
// ==================================================

const accounts =
    JSON.parse(
        fs.readFileSync(
            "accounts.json",
            "utf8"
        )
    );

const loanData =
    JSON.parse(
        fs.readFileSync(
            "loan.json",
            "utf8"
        )
    );

const brokerData =
    JSON.parse(
        fs.readFileSync(
            "broker.json",
            "utf8"
        )
    );

const vaultData =
    JSON.parse(
        fs.readFileSync(
            "vault.json",
            "utf8"
        )
    );


const USD = {
    currency: "USD",
    issuer: accounts.issuer.address
};


// ==================================================
// LOANPAY FLAGS
// ==================================================
//
// Official XLS-66 LoanPay flags:
//
// tfLoanOverpayment = 0x00010000
// tfLoanFullPayment = 0x00020000
// tfLoanLatePayment = 0x00040000
//

const tfLoanOverpayment =
    65536;

const tfLoanFullPayment =
    131072;

const tfLoanLatePayment =
    262144;


// ==================================================
// MODES
// ==================================================

type Mode =
    | "regular"
    | "late"
    | "full"
    | "overpay"
    | "status";


// ==================================================
// XRPL ISSUED-CURRENCY PRECISION
// ==================================================
//
// XRPL issued tokens use 15 significant
// decimal digits.
//
// Loan fields such as PeriodicPayment use
// the XRPL Number type and may expose more
// precision than an IOU Amount can serialize.
//
// Example:
//
// PeriodicPayment
// 333.3358701198967648
//
// + ServiceFee 1
//
// JS:
// 334.33587011989675
//
// Valid XRPL IOU:
// 334.335870119897
//
// We round UP so that we never accidentally
// submit slightly less than the required amount.
//

function toXRPLAmount(
    value: number
): string {

    if (
        !Number.isFinite(value) ||
        value <= 0
    ) {
        throw new Error(
            `Invalid XRPL amount: ${value}`
        );
    }

    const exponent =
        Math.floor(
            Math.log10(
                Math.abs(value)
            )
        );

    // 15 significant digits total.
    const decimals =
        Math.max(
            0,
            14 - exponent
        );

    const factor =
        10 ** decimals;

    const roundedUp =
        Math.ceil(
            value * factor
        ) / factor;

    return roundedUp
        .toFixed(decimals)
        .replace(
            /\.?0+$/,
            ""
        );
}


// ==================================================
// READ LOAN
// ==================================================

async function getLoan() {

    const response: any =
        await client.request({
            command:
                "ledger_entry",

            index:
                loanData.loanID,

            ledger_index:
                "validated"
        });

    return response.result.node;
}


// ==================================================
// READ LOAN BROKER
// ==================================================

async function getBroker() {

    const response: any =
        await client.request({
            command:
                "ledger_entry",

            index:
                brokerData.loanBrokerID,

            ledger_index:
                "validated"
        });

    return response.result.node;
}


// ==================================================
// READ VAULT
// ==================================================

async function getVault() {

    const response: any =
        await client.request({
            command:
                "vault_info",

            vault_id:
                vaultData.vaultID,

            ledger_index:
                "validated"
        });

    return response.result.vault;
}


// ==================================================
// USD BALANCE
// ==================================================

async function getBalance(
    address: string
): Promise<number> {

    const response: any =
        await client.request({
            command:
                "account_lines",

            account:
                address,

            peer:
                accounts.issuer.address,

            ledger_index:
                "validated"
        });

    const line =
        response.result.lines.find(
            (item: any) =>
                item.currency === "USD"
        );

    return line
        ? Number(line.balance)
        : 0;
}


// ==================================================
// LEDGER TIME
// ==================================================

async function ledgerTime():
Promise<number> {

    const response: any =
        await client.request({
            command:
                "ledger",

            ledger_index:
                "validated"
        });

    return Number(
        response
            .result
            .ledger
            .close_time
    );
}


// ==================================================
// DISPLAY CURRENT STATE
// ==================================================

async function showState(
    title: string
) {

    const loan =
        await getLoan();

    const broker =
        await getBroker();

    const vault =
        await getVault();

    const balance =
        await getBalance(
            accounts.borrower.address
        );

    const now =
        await ledgerTime();


    console.log(
        `\n========== ${title} ==========`
    );


    console.log(
        "\nLOAN"
    );

    console.log(
        "Loan ID              :",
        loanData.loanID
    );

    console.log(
        "Borrower             :",
        loan.Borrower
    );

    console.log(
        "PrincipalOutstanding :",
        loan.PrincipalOutstanding
    );

    console.log(
        "TotalValueOutstanding:",
        loan.TotalValueOutstanding
    );

    console.log(
        "PeriodicPayment      :",
        loan.PeriodicPayment
    );

    console.log(
        "LoanServiceFee       :",
        loan.LoanServiceFee
    );

    console.log(
        "PaymentRemaining     :",
        loan.PaymentRemaining
    );

    console.log(
        "NextPaymentDueDate   :",
        loan.NextPaymentDueDate
    );


    console.log(
        "\nTIME"
    );

    console.log(
        "Ledger time          :",
        now
    );

    console.log(
        "Seconds until due    :",
        Number(
            loan.NextPaymentDueDate
        ) - now
    );


    console.log(
        "\nBORROWER"
    );

    console.log(
        "USD balance          :",
        balance
    );


    console.log(
        "\nBROKER"
    );

    console.log(
        "DebtTotal            :",
        broker.DebtTotal
    );

    console.log(
        "CoverAvailable       :",
        broker.CoverAvailable
    );


    console.log(
        "\nVAULT"
    );

    console.log(
        "AssetsTotal          :",
        vault.AssetsTotal
    );

    console.log(
        "AssetsAvailable      :",
        vault.AssetsAvailable
    );


    return {
        loan,
        broker,
        vault,
        balance,
        now
    };
}


// ==================================================
// FUND BORROWER FOR DEMO
// ==================================================
//
// Only used on the hackathon test ledger.
//
// In a real lending product, repayment funds
// would come from the borrower's own revenue /
// treasury rather than the token issuer.
//

async function fundBorrowerIfNeeded(
    required: number
) {

    const borrower =
        Wallet.fromSeed(
            accounts.borrower.seed
        );

    const issuer =
        Wallet.fromSeed(
            accounts.issuer.seed
        );

    const balance =
        await getBalance(
            borrower.address
        );


    if (
        balance >= required
    ) {
        return;
    }


    const missing =
        required - balance;

    const fundingAmount =
        toXRPLAmount(
            missing
        );


    console.log(
        "\nSimulation business revenue:"
    );

    console.log(
        "Borrower balance:",
        balance
    );

    console.log(
        "Funding required:",
        fundingAmount,
        "USD"
    );


    const tx: any = {
        TransactionType:
            "Payment",

        Account:
            issuer.address,

        Destination:
            borrower.address,

        Amount: {
            ...USD,

            value:
                fundingAmount
        }
    };


    validate(tx);


    const result =
        await client.submitAndWait(
            tx,
            {
                wallet:
                    issuer,

                autofill:
                    true
            }
        );


    const meta: any =
        result.result.meta;


    if (
        typeof meta !== "object"
    ) {
        throw new Error(
            "Funding transaction metadata missing."
        );
    }


    console.log(
        "Funding Payment:",
        meta.TransactionResult
    );

    console.log(
        "Funding tx hash:",
        result.result.hash
    );


    if (
        meta.TransactionResult !==
        "tesSUCCESS"
    ) {
        throw new Error(
            `Funding failed: ${meta.TransactionResult}`
        );
    }
}


// ==================================================
// SUBMIT LOANPAY
// ==================================================

async function submitLoanPay(
    amount: number,
    flags = 0
) {

    const borrower =
        Wallet.fromSeed(
            accounts.borrower.seed
        );


    const xrplAmount =
        toXRPLAmount(
            amount
        );


    console.log(
        "\nSubmitting LoanPay..."
    );

    console.log(
        "Raw amount  :",
        amount
    );

    console.log(
        "XRPL amount :",
        xrplAmount
    );

    console.log(
        "Flags       :",
        flags
    );


    const tx: any = {
        TransactionType:
            "LoanPay",

        Account:
            borrower.address,

        LoanID:
            loanData.loanID,

        Amount: {
            ...USD,

            value:
                xrplAmount
        },

        Flags:
            flags
    };


    // Validate transaction structure locally
    // before signing/submission.
    validate(tx);


    const result =
        await client.submitAndWait(
            tx,
            {
                wallet:
                    borrower,

                autofill:
                    true
            }
        );


    const meta: any =
        result.result.meta;


    if (
        typeof meta !== "object"
    ) {
        throw new Error(
            "LoanPay metadata missing."
        );
    }


    console.log(
        "LoanPay result:",
        meta.TransactionResult
    );

    console.log(
        "Transaction hash:",
        result.result.hash
    );


    if (
        meta.TransactionResult !==
        "tesSUCCESS"
    ) {
        throw new Error(
            `LoanPay failed: ${meta.TransactionResult}`
        );
    }


    return {
        result,
        amount:
            xrplAmount
    };
}


// ==================================================
// REGULAR PAYMENT
// ==================================================

async function regularPayment() {

    const loan =
        await getLoan();

    const now =
        await ledgerTime();


    if (
        now >
        Number(
            loan.NextPaymentDueDate
        )
    ) {
        throw new Error(
            "Payment deadline has passed. Use: npm run repay -- late"
        );
    }


    const periodicPayment =
        Number(
            loan.PeriodicPayment
        );

    const serviceFee =
        Number(
            loan.LoanServiceFee ?? 0
        );


    const amount =
        periodicPayment +
        serviceFee;


    console.log(
        "\n=== REGULAR PAYMENT ==="
    );

    console.log(
        "PeriodicPayment:",
        periodicPayment
    );

    console.log(
        "LoanServiceFee:",
        serviceFee
    );

    console.log(
        "Raw required amount:",
        amount
    );

    console.log(
        "XRPL serialized amount:",
        toXRPLAmount(amount)
    );


    await fundBorrowerIfNeeded(
        amount
    );


    return await submitLoanPay(
        amount
    );
}


// ==================================================
// LATE PAYMENT
// ==================================================

async function latePayment() {

    const loan =
        await getLoan();

    const now =
        await ledgerTime();


    if (
        now <=
        Number(
            loan.NextPaymentDueDate
        )
    ) {
        throw new Error(
            `Payment is not late yet. Wait ${
                Number(
                    loan.NextPaymentDueDate
                ) - now
            } seconds.`
        );
    }


    const periodicPayment =
        Number(
            loan.PeriodicPayment
        );

    const serviceFee =
        Number(
            loan.LoanServiceFee ?? 0
        );

    const lateFee =
        Number(
            loan.LatePaymentFee ?? 0
        );


    // Deliberately provide a sufficient upper
    // bound for the protocol-calculated late
    // interest.
    //
    // XLS-66 ignores excess in this late-payment
    // scenario rather than charging the borrower
    // arbitrary extra funds.

    const safetyBuffer =
        100;


    const amount =
        periodicPayment +
        serviceFee +
        lateFee +
        safetyBuffer;


    console.log(
        "\n=== LATE PAYMENT ==="
    );

    console.log(
        "PeriodicPayment:",
        periodicPayment
    );

    console.log(
        "LoanServiceFee:",
        serviceFee
    );

    console.log(
        "LatePaymentFee:",
        lateFee
    );

    console.log(
        "Submitted upper bound:",
        toXRPLAmount(amount)
    );


    await fundBorrowerIfNeeded(
        amount
    );


    return await submitLoanPay(
        amount,
        tfLoanLatePayment
    );
}


// ==================================================
// EARLY FULL PAYMENT
// ==================================================

async function fullPayment() {

    const loan =
        await getLoan();


    if (
        Number(
            loan.PaymentRemaining
        ) <= 0
    ) {
        throw new Error(
            "Loan is already fully paid."
        );
    }


    const totalOutstanding =
        Number(
            loan.TotalValueOutstanding
        );

    const principal =
        Number(
            loan.PrincipalOutstanding
        );

    const serviceFee =
        Number(
            loan.LoanServiceFee ?? 0
        );

    const closeFee =
        Number(
            loan.ClosePaymentFee ?? 0
        );

    // Rates are in 1/10th basis points.
    const closeRate =
        Number(
            loan.CloseInterestRate ?? 0
        ) / 100000;


    const closeInterest =
        principal *
        closeRate;


    // Upper bound sufficient for early full
    // repayment:
    //
    // outstanding value
    // + service fee
    // + close fee
    // + close interest.

    const amount =
        totalOutstanding +
        serviceFee +
        closeFee +
        closeInterest;


    console.log(
        "\n=== EARLY FULL PAYMENT ==="
    );

    console.log(
        "TotalValueOutstanding:",
        totalOutstanding
    );

    console.log(
        "PrincipalOutstanding:",
        principal
    );

    console.log(
        "LoanServiceFee:",
        serviceFee
    );

    console.log(
        "ClosePaymentFee:",
        closeFee
    );

    console.log(
        "CloseInterestRate:",
        loan.CloseInterestRate ?? 0
    );

    console.log(
        "Close interest:",
        closeInterest
    );

    console.log(
        "Submitted amount:",
        toXRPLAmount(amount)
    );


    await fundBorrowerIfNeeded(
        amount
    );


    return await submitLoanPay(
        amount,
        tfLoanFullPayment
    );
}


// ==================================================
// OVERPAYMENT
// ==================================================

async function overpayment(
    extra: number
) {

    if (
        !Number.isFinite(extra) ||
        extra <= 0
    ) {
        throw new Error(
            "Example: npx tsx repay.ts overpay 100"
        );
    }


    const loan =
        await getLoan();


    // Loan ledger flag:
    //
    // lsfLoanOverpayment
    // = 0x00040000
    // = 262144

    const loanFlags =
        Number(
            loan.Flags ?? 0
        );


    const supportsOverpayment =
        (
            loanFlags &
            262144
        ) !== 0;


    if (
        !supportsOverpayment
    ) {
        throw new Error(
            "This Loan was not created with overpayment enabled."
        );
    }


    const regularAmount =
        Number(
            loan.PeriodicPayment
        ) +
        Number(
            loan.LoanServiceFee ?? 0
        );


    const amount =
        regularAmount +
        extra;


    console.log(
        "\n=== OVERPAYMENT ==="
    );

    console.log(
        "Regular payment:",
        regularAmount
    );

    console.log(
        "Extra principal:",
        extra
    );

    console.log(
        "Submitted amount:",
        toXRPLAmount(amount)
    );


    await fundBorrowerIfNeeded(
        amount
    );


    return await submitLoanPay(
        amount,
        tfLoanOverpayment
    );
}


// ==================================================
// MAIN
// ==================================================

async function main() {

    await client.connect();


    try {

        console.log(
            "\n=============================="
        );

        console.log(
            "       AYZE LOAN REPAYMENT"
        );

        console.log(
            "=============================="
        );

        console.log(
            "Network:",
            WSS
        );


        const mode =
            (
                process.argv[2] ??
                "status"
            ) as Mode;


        const before =
            await showState(
                "BEFORE"
            );


        let payment:
            {
                result: any;
                amount: string;
            }
            | undefined;


        switch (
            mode
        ) {

            case "regular":

                payment =
                    await regularPayment();

                break;


            case "late":

                payment =
                    await latePayment();

                break;


            case "full":

                payment =
                    await fullPayment();

                break;


            case "overpay":

                payment =
                    await overpayment(
                        Number(
                            process.argv[3]
                        )
                    );

                break;


            case "status":

                return;


            default:

                throw new Error(
                    "Modes: status | regular | late | full | overpay"
                );
        }


        const after =
            await showState(
                "AFTER"
            );


        // ============================================
        // DOCUMENTATION EVIDENCE
        // ============================================

        if (
            payment
        ) {

            const evidence = {

                track:
                    "Track 1 - Open-ended Vault",

                transactionType:
                    "LoanPay",

                mode,

                transactionResult:
                    "tesSUCCESS",

                transactionHash:
                    payment
                        .result
                        .result
                        .hash,

                amountSubmitted:
                    payment.amount,

                loanID:
                    loanData.loanID,

                borrower:
                    accounts
                        .borrower
                        .address,

                before: {

                    principalOutstanding:
                        before
                            .loan
                            .PrincipalOutstanding,

                    totalValueOutstanding:
                        before
                            .loan
                            .TotalValueOutstanding,

                    paymentRemaining:
                        before
                            .loan
                            .PaymentRemaining,

                    debtTotal:
                        before
                            .broker
                            .DebtTotal,

                    coverAvailable:
                        before
                            .broker
                            .CoverAvailable,

                    vaultAssetsTotal:
                        before
                            .vault
                            .AssetsTotal,

                    vaultAssetsAvailable:
                        before
                            .vault
                            .AssetsAvailable
                },

                after: {

                    principalOutstanding:
                        after
                            .loan
                            .PrincipalOutstanding,

                    totalValueOutstanding:
                        after
                            .loan
                            .TotalValueOutstanding,

                    paymentRemaining:
                        after
                            .loan
                            .PaymentRemaining,

                    debtTotal:
                        after
                            .broker
                            .DebtTotal,

                    coverAvailable:
                        after
                            .broker
                            .CoverAvailable,

                    vaultAssetsTotal:
                        after
                            .vault
                            .AssetsTotal,

                    vaultAssetsAvailable:
                        after
                            .vault
                            .AssetsAvailable
                }
            };


            fs.writeFileSync(
                "repayment.json",

                JSON.stringify(
                    evidence,
                    null,
                    2
                )
            );


            console.log(
                "\nrepayment.json saved."
            );
        }


        console.log(
            "\n✅ Repayment validated on XRPL"
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


// ==================================================
// ERROR HANDLING
// ==================================================

main().catch(
    (error) => {

        console.error(
            "\n❌",
            error instanceof Error
                ? error.message
                : error
        );

        process.exit(1);
    }
);
/** Application error codes. Ledger rejections use `XRPL_<TransactionResult>`. */
export type AyzeCode =
  | "AYZE_FORBIDDEN_ROLE"
  | "AYZE_UNAUTHENTICATED"
  | "AYZE_KYC_REQUIRED"
  | "AYZE_PS_NOT_ACCREDITED"
  | "AYZE_INSUFFICIENT_LIQUIDITY"
  | "AYZE_BROKER_COVER_INSUFFICIENT"
  | "AYZE_INSUFFICIENT_FUNDS"
  | "AYZE_ALREADY_GUARANTEED"
  | "AYZE_LOAN_NOT_DEFAULTED"
  | "AYZE_INVALID_TERMS"
  | "AYZE_INVALID_INPUT"
  | "AYZE_NOT_FOUND"
  | "AYZE_EMAIL_TAKEN"
  | "AYZE_BAD_CREDENTIALS"
  | "AYZE_LOAN_CLOSED";

export class AyzeError extends Error {
  constructor(
    public code: AyzeCode | `XRPL_${string}`,
    message: string,
    public hash?: string,
  ) {
    super(message);
  }
}

export const fail = (code: AyzeCode, message: string): never => {
  throw new AyzeError(code, message);
};

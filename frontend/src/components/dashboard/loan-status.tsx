import { Badge } from "@/components/dashboard/stat";
import type { LoanView } from "@/server/views";

type Tone = "good" | "warn" | "bad" | "neutral" | "accent";

/** One badge combining the registry status and the ledger's view of the loan. */
export function LoanStatusBadge({ loan }: { loan: Pick<LoanView, "status" | "ledgerStatus"> }) {
  let label = "Current";
  let tone: Tone = "good";
  if (loan.status === "closed") [label, tone] = ["Closed", "neutral"];
  else if (loan.status === "repaid" || loan.ledgerStatus === "repaid") [label, tone] = ["Repaid", "neutral"];
  else if (loan.status === "defaulted" || loan.ledgerStatus === "defaulted") [label, tone] = ["Defaulted", "bad"];
  else if (loan.ledgerStatus === "defaultable") [label, tone] = ["In default window", "bad"];
  else if (loan.ledgerStatus === "late") [label, tone] = ["Late", "warn"];
  return <Badge tone={tone}>{label}</Badge>;
}

export const ROLES = [
  { id: "broker", label: "Broker", hint: "Structure deals between parties" },
  { id: "lender", label: "Lender", hint: "Fund working capital" },
  { id: "borrower", label: "Borrower", hint: "Finance your business" },
  {
    id: "protection-seller",
    label: "Protection seller",
    hint: "Cover part of the risk",
  },
] as const;

export type RoleId = (typeof ROLES)[number]["id"];

export const isRoleId = (value: unknown): value is RoleId => ROLES.some((role) => role.id === value);

/** Landing page of each role. */
export const ROLE_HOME: Record<RoleId, string> = {
  broker: "/broker",
  lender: "/market",
  borrower: "/market",
  "protection-seller": "/protect",
};

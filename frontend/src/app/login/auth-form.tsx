"use client";

import { useActionState, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { RoleSelector } from "@/components/ui/role-selector";
import type { RoleId } from "@/lib/roles";
import { connectWalletAction, generateWalletAction, login, register, type ActionResult, type WalletActionResult } from "@/server/actions";

type Mode = "login" | "register" | "wallet";

const MODES = [
  { value: "login", label: "Log in" },
  { value: "register", label: "Create account" },
  { value: "wallet", label: "Connect wallet" },
] as const;

const WALLET_ROLES: readonly RoleId[] = ["lender", "protection-seller"];

/**
 * Log in / create account / connect wallet. Broker and borrower are custodial accounts
 * (email + password, wallet generated and held server-side); lender and protection-seller
 * are wallet-only (paste a family seed, or have one generated for them).
 */
export function AuthForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [role, setRole] = useState<RoleId | null>(null);
  const [state, formAction, pending] = useActionState(
    (prev: ActionResult, formData: FormData) => (formData.get("mode") === "register" ? register(prev, formData) : login(prev, formData)),
    null,
  );

  const isRegister = mode === "register";

  /* Lender / protection-seller don't get an email/password form: send them to "Connect wallet". */
  const handleRoleChange = (next: RoleId) => {
    setRole(next);
    if (isRegister && WALLET_ROLES.includes(next)) setMode("wallet");
  };

  if (mode === "wallet") {
    return <WalletForm initialRole={role} onSwitch={setMode} />;
  }

  return (
    <form action={formAction} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="mode" value={mode} />
      <Segmented label="Account action" options={MODES} value={mode} onChange={setMode} />

      <div className="flex flex-col gap-4">
        {isRegister && <Field label="Company" name="company" autoComplete="organization" required />}
        <Field label="Email" name="email" type="email" autoComplete="email" inputMode="email" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          required
        />
      </div>

      {isRegister && (
        <div className="flex flex-col gap-1.5">
          <RoleSelector value={role} onChange={handleRoleChange} />
          <input type="hidden" name="role" value={role ?? ""} />
          <p className="text-xs text-ink/60">Lender and protection seller accounts connect a wallet instead — no email or password.</p>
        </div>
      )}

      {state && !state.ok && (
        <p className="text-xs text-red-400">
          <code className="mr-1">{state.code}</code>
          {state.message}
        </p>
      )}

      <Button type="submit" size="lg" className="mt-2" disabled={pending}>
        {pending ? (isRegister ? "Creating wallet on the ledger…" : "Connecting…") : isRegister ? "Create account" : "Log in"}
      </Button>

      {!isRegister && (
        <p className="text-center text-sm text-ink/60">
          New to AYZE?{" "}
          <button
            type="button"
            onClick={() => setMode("register")}
            className="font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline"
          >
            Create an account
          </button>
        </p>
      )}
    </form>
  );
}

/** Wallet-only sign-in: paste a family seed to reconnect, or have one generated. */
function WalletForm({ initialRole, onSwitch }: { initialRole: RoleId | null; onSwitch: (mode: Mode) => void }) {
  const [role, setRole] = useState<RoleId | null>(initialRole && WALLET_ROLES.includes(initialRole) ? initialRole : null);
  const [connectState, connectAction, connectPending] = useActionState<WalletActionResult, FormData>(connectWalletAction, null);
  const [generateState, generateAction, generatePending] = useActionState<WalletActionResult, FormData>(generateWalletAction, null);

  /* Once a wallet has been generated its seed is shown exactly once; the session is already set. */
  if (generateState?.ok && generateState.seed) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2 rounded-control border border-olympic/40 bg-olympic/10 p-4">
          <p className="text-sm font-semibold">Wallet created — save this seed now</p>
          <p className="text-xs text-ink/60">It will not be shown again. Anyone with this seed controls the wallet.</p>
          <code className="break-all rounded-sm bg-ink/[0.06] px-2 py-1.5 text-xs">{generateState.seed}</code>
          <p className="text-xs text-ink/60">
            Address: <span className="break-all">{generateState.address}</span>
          </p>
        </div>
        <ButtonLink href="/dashboard" size="lg">
          Continue to dashboard
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Segmented label="Account action" options={MODES} value="wallet" onChange={onSwitch} />

      <RoleSelector value={role} onChange={setRole} roles={WALLET_ROLES} />

      <form action={connectAction} className="flex flex-col gap-4">
        <input type="hidden" name="role" value={role ?? ""} />
        <Field label="Wallet seed" name="seed" type="password" autoComplete="off" placeholder="sEd..." required />
        {connectState && !connectState.ok && (
          <p className="text-xs text-red-400">
            <code className="mr-1">{connectState.code}</code>
            {connectState.message}
          </p>
        )}
        <Button type="submit" size="lg" disabled={!role || connectPending}>
          {connectPending ? "Connecting…" : "Connect wallet"}
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-ink/40">
        <span className="h-px flex-1 bg-ink/15" />
        or
        <span className="h-px flex-1 bg-ink/15" />
      </div>

      <form action={generateAction} className="flex flex-col gap-4">
        <input type="hidden" name="role" value={role ?? ""} />
        {generateState && !generateState.ok && (
          <p className="text-xs text-red-400">
            <code className="mr-1">{generateState.code}</code>
            {generateState.message}
          </p>
        )}
        <Button type="submit" variant="outline" size="lg" disabled={!role || generatePending}>
          {generatePending ? "Creating wallet on the ledger…" : "Generate wallet"}
        </Button>
      </form>

      <p className="text-center text-sm text-ink/60">
        <button
          type="button"
          onClick={() => onSwitch("login")}
          className="font-medium text-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:underline"
        >
          Back to log in
        </button>
      </p>
    </div>
  );
}

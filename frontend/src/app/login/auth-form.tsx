"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { RoleSelector } from "@/components/ui/role-selector";
import type { RoleId } from "@/lib/roles";
import { login, register, type ActionResult } from "@/server/actions";

type Mode = "login" | "register";

const MODES = [
  { value: "login", label: "Log in" },
  { value: "register", label: "Create account" },
] as const;

/**
 * Log in / create account. Creating an account generates a funded XRPL wallet for
 * the chosen role (borrowers also receive the AYZE KYC credential); logging in
 * reuses that wallet.
 */
export function AuthForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [role, setRole] = useState<RoleId | null>(null);
  const [state, formAction, pending] = useActionState(
    (prev: ActionResult, formData: FormData) => (formData.get("mode") === "register" ? register(prev, formData) : login(prev, formData)),
    null,
  );

  const isRegister = mode === "register";

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
          <RoleSelector value={role} onChange={setRole} />
          <input type="hidden" name="role" value={role ?? ""} />
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

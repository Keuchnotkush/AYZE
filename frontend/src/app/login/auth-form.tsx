"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { RoleSelector } from "@/components/ui/role-selector";
import type { RoleId } from "@/lib/roles";

type Mode = "login" | "register";

const MODES = [
  { value: "login", label: "Log in" },
  { value: "register", label: "Create account" },
] as const;

/**
 * Log in / create account form. Submission is wired to the backend later;
 * for now it collects the values and keeps the role on the client.
 */
export function AuthForm() {
  const [mode, setMode] = useState<Mode>("login");
  const [role, setRole] = useState<RoleId | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  const isRegister = mode === "register";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRegister && !role) {
      setRoleError("Choose a role to continue.");
      return;
    }
    setRoleError(null);
    // TODO: call the auth backend once it is available.
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <Segmented
        label="Account action"
        options={MODES}
        value={mode}
        onChange={(next) => {
          setMode(next);
          setRoleError(null);
        }}
      />

      <div className="flex flex-col gap-4">
        {isRegister && (
          <Field label="Company" name="company" autoComplete="organization" required />
        )}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
        />
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
          <RoleSelector value={role} onChange={(next) => { setRole(next); setRoleError(null); }} />
          {roleError && <p className="text-xs text-red-400">{roleError}</p>}
        </div>
      )}

      <Button type="submit" size="lg" className="mt-2">
        {isRegister ? "Create account" : "Log in"}
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

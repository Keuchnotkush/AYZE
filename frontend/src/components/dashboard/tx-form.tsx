"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { txUrl } from "@/lib/format";
import type { ActionResult } from "@/server/actions";

type TxAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

type FieldSpec = {
  name: string;
  label: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  defaultValue?: string;
  /** `amount` is free text validated server-side (XRP with up to 6 decimals) but gets a decimal keypad on phones. */
  type?: "text" | "number" | "amount";
};

/** Mobile keyboard per field kind: text fields must not get the numeric keypad. */
const INPUT_MODE: Record<NonNullable<FieldSpec["type"]>, "text" | "numeric" | "decimal"> = {
  text: "text",
  number: "numeric",
  amount: "decimal",
};

type TxFormProps = {
  action: TxAction;
  className?: string;
  inline?: boolean;
  fields?: FieldSpec[];
  hidden?: Record<string, string>;
  submitLabel: string;
  pendingLabel?: string;
  variant?: "primary" | "outline" | "contrast";
  disabled?: boolean;
  disabledReason?: string;
};

/** Form bound to a Server Action; shows the ledger outcome under the button. */
export function TxForm({
  action,
  fields = [],
  hidden = {},
  submitLabel,
  pendingLabel = "Submitting…",
  variant = "primary",
  disabled,
  disabledReason,
  className,
  inline,
}: TxFormProps) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className={className ?? (inline ? "flex flex-col gap-2" : "flex flex-col gap-3")}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields.map((field) => (
        <Field
          key={field.name}
          name={field.name}
          label={field.label}
          placeholder={field.placeholder}
          hint={field.hint}
          required={field.required}
          defaultValue={field.defaultValue}
          type={field.type === "number" ? "number" : "text"}
          inputMode={INPUT_MODE[field.type ?? "text"]}
          autoComplete="off"
        />
      ))}
      <Button type="submit" variant={variant} pending={pending} disabled={disabled} title={disabled ? disabledReason : undefined}>
        {pending ? pendingLabel : submitLabel}
      </Button>
      {disabled && disabledReason && <p className="text-xs text-ink/60">{disabledReason}</p>}
      <TxResult state={state} />
    </form>
  );
}

export function TxResult({ state }: { state: ActionResult }) {
  if (!state) return null;
  return (
    <div
      role="status"
      className={
        state.ok
          ? "flex flex-col gap-1 rounded-control bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800"
          : "flex flex-col gap-1 rounded-control bg-red-500/10 px-3 py-2 text-sm text-red-800"
      }
    >
      <span>
        {!state.ok && <code className="mr-2 rounded bg-red-500/15 px-1.5 py-0.5 text-xs font-semibold">{state.code}</code>}
        {state.message}
      </span>
      {state.hashes.length > 0 && (
        <span className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
          {state.hashes.map((hash) => (
            <a key={hash} href={txUrl(hash)} target="_blank" rel="noreferrer" className="underline underline-offset-4">
              {hash.slice(0, 10)}…
            </a>
          ))}
        </span>
      )}
    </div>
  );
}

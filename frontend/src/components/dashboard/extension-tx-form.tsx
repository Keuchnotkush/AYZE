"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { TxResult } from "@/components/dashboard/tx-form";
import { PROVIDER_LABEL, signAndSubmit, type ExtensionProvider } from "@/lib/wallet-extension";
import type { ActionResult, PrepareResult } from "@/server/actions";

type FieldSpec = { name: string; label: string; placeholder?: string; hint?: string; required?: boolean; defaultValue?: string; type?: "text" | "amount" };

type ExtensionTxFormProps = {
  provider: ExtensionProvider;
  /** Server action returning the unsigned transactions. */
  prepare: (formData: FormData) => Promise<PrepareResult>;
  /** Server action that verifies the hashes on the ledger and updates the registry. */
  record: (formData: FormData, hashes: string[]) => Promise<ActionResult>;
  fields?: FieldSpec[];
  hidden?: Record<string, string>;
  submitLabel: string;
  variant?: "primary" | "outline" | "contrast";
  disabled?: boolean;
  disabledReason?: string;
  inline?: boolean;
};

/**
 * TxForm for extension-connected wallets: prepare on the server, sign and submit each transaction
 * in the extension (one prompt per transaction), then let the server verify and record. If a later
 * transaction of a batch is refused, the ones already validated are still recorded.
 */
export function ExtensionTxForm({ provider, prepare, record, fields = [], hidden = {}, submitLabel, variant = "primary", disabled, disabledReason, inline }: ExtensionTxFormProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [step, setStep] = useState<string | null>(null);
  const [state, setState] = useState<ActionResult>(null);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    start(async () => {
      setState(null);
      setStep("Preparing…");
      const prep = await prepare(formData);
      if (!prep.ok) {
        setState({ ok: false, code: prep.code, message: prep.message, hashes: [] });
        setStep(null);
        return;
      }
      const hashes: string[] = [];
      let failure: string | null = null;
      for (const [i, tx] of prep.txs.entries()) {
        setStep(`Sign ${i + 1}/${prep.txs.length} in ${PROVIDER_LABEL[provider]}…`);
        try {
          hashes.push(await signAndSubmit(provider, tx));
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
          break;
        }
      }
      if (hashes.length === 0) {
        setState({ ok: false, code: "AYZE_EXTENSION_REJECTED", message: failure ?? "Nothing was signed.", hashes: [] });
        setStep(null);
        return;
      }
      setStep("Confirming on the ledger…");
      const result = await record(formData, hashes);
      setState(result && !result.ok ? result : result && failure ? { ...result, message: `${result.message} (${failure})` } : result);
      setStep(null);
      router.refresh();
    });
  };

  return (
    <form onSubmit={onSubmit} className={inline ? "flex flex-col gap-2" : "flex flex-col gap-3"}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields.map((f) => (
        <Field key={f.name} name={f.name} label={f.label} placeholder={f.placeholder} hint={f.hint} required={f.required} defaultValue={f.defaultValue} type="text" inputMode={f.type === "amount" ? "decimal" : "text"} autoComplete="off" />
      ))}
      <Button type="submit" variant={variant} disabled={pending || disabled} title={disabled ? disabledReason : undefined}>
        {pending ? (step ?? "Submitting…") : `${submitLabel} · ${PROVIDER_LABEL[provider]}`}
      </Button>
      {disabled && disabledReason && <p className="text-xs text-ink/60">{disabledReason}</p>}
      <TxResult state={state} />
    </form>
  );
}

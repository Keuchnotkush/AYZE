import { accountUrl, shortAddress } from "@/lib/format";

/** Truncated r-address linking to the explorer. */
export function Address({ value, label }: { value: string; label?: string }) {
  return (
    <a
      href={accountUrl(value)}
      target="_blank"
      rel="noreferrer"
      title={value}
      className="font-mono text-xs text-ink/70 underline-offset-4 hover:underline"
    >
      {label ? `${label} · ` : ""}
      {shortAddress(value)}
    </a>
  );
}

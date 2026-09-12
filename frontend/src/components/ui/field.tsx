import { useId, type ComponentProps } from "react";
import { cn } from "@/lib/cn";

type FieldProps = ComponentProps<"input"> & {
  label: string;
  hint?: string;
  error?: string;
};

/**
 * Labelled text input. Follows the ink/surface pair, so it works on light
 * and `.on-dark` containers alike.
 */
export function Field({ label, hint, error, className, id, ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className={cn(
          "h-11 rounded-control border bg-ink/[0.05] px-3.5 text-base text-ink placeholder:text-ink/40",
          "border-ink/25 hover:border-ink/40",
          "focus:outline-none focus:border-olympic focus:ring-2 focus:ring-olympic/40",
          error && "border-red-400 focus:border-red-400 focus:ring-red-400/40",
        )}
        {...props}
      />
      {message && (
        <p id={messageId} className={cn("text-xs", error ? "text-red-400" : "text-ink/60")}>
          {message}
        </p>
      )}
    </div>
  );
}

import { useId, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";

type FieldProps = ComponentProps<"input"> & {
  label: string;
  hint?: string;
  error?: string;
};

/** Labelled text input (shadcn Label + Input). Hint or error is wired through `aria-describedby`. */
export function Field({ label, hint, error, className, id, ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const messageId = `${inputId}-message`;
  const message = error ?? hint;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <Input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={message ? messageId : undefined}
        className="h-11 px-3.5 text-base md:text-base"
        {...props}
      />
      {message && (
        <p id={messageId} className={cn("text-xs", error ? "text-destructive" : "text-ink/60")}>
          {message}
        </p>
      )}
    </div>
  );
}

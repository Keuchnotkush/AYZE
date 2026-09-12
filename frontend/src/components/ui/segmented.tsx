import { cn } from "@/lib/cn";

type Option<T extends string> = { value: T; label: string };

type SegmentedProps<T extends string> = {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/** Two-or-more way toggle; the selected segment fills with ink. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("grid auto-cols-fr grid-flow-col rounded-control border border-ink/25 p-1", className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-9 rounded-[calc(var(--radius-control)-0.25rem)] text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olympic",
              selected ? "bg-ink text-surface" : "text-ink/70 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

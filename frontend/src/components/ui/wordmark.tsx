import { cn } from "@/lib/cn";

type WordmarkProps = {
  className?: string;
  /** Renders as a heading on the landing page, a span elsewhere. */
  as?: "h1" | "span";
};

/**
 * The AYZE wordmark: the four letters followed by a round point whose
 * diameter is one third of the cap height. Inherits colour and font-size,
 * so size it with text-* utilities and colour it with text-*.
 */
export function Wordmark({ className, as: Tag = "span" }: WordmarkProps) {
  return (
    <Tag
      className={cn(
        "inline-flex items-baseline font-bold leading-none tracking-brand select-none",
        className,
      )}
    >
      <span>AYZE</span>
      <span
        aria-hidden
        className="ml-[0.06em] inline-block rounded-full bg-current"
        style={{ width: "calc(1cap / 3)", height: "calc(1cap / 3)" }}
      />
      <span className="sr-only">.</span>
    </Tag>
  );
}

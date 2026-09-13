import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Option<T extends string> = { value: T; label: string };

type SegmentedProps<T extends string> = {
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/** Two-or-more way toggle (shadcn Tabs used as a control: no panels). */
export function Segmented<T extends string>({ label, options, value, onChange, className }: SegmentedProps<T>) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)} className={className}>
      <TabsList aria-label={label} className="grid h-11 w-full auto-cols-fr grid-flow-col">
        {options.map((option) => (
          <TabsTrigger key={option.value} value={option.value} className="h-full data-active:font-semibold">
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

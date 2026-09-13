import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/dashboard/stat";

type EmptyStateProps = { icon: LucideIcon; title: string; hint: ReactNode; action?: ReactNode };

/** A card that says what is missing and what to do next, instead of a bare "No … yet." */
export function EmptyState({ icon: Icon, title, hint, action }: EmptyStateProps) {
  return (
    <Card className="py-8">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-ink/[0.06] text-ink/70">
          <Icon className="size-5" aria-hidden />
        </span>
        <p className="text-sm font-semibold">{title}</p>
        <p className="max-w-sm text-sm text-ink/60">{hint}</p>
        {action && <div className="pt-2">{action}</div>}
      </div>
    </Card>
  );
}

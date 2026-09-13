import { Skeleton } from "@/components/ui/skeleton";

/** Shown while a role page reads the ledger (vault_info, ledger_entry, account_info per row). */
export default function Loading() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Skeleton className="h-8 w-44" />
        <div className="flex gap-3">
          <Skeleton className="h-[4.25rem] w-36 rounded-control" />
          <Skeleton className="h-[4.25rem] w-56 rounded-control" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((k) => (
          <div key={k} className="flex flex-col gap-4 rounded-control border border-ink/15 p-5">
            <div className="flex justify-between gap-3">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3.5 w-64" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((s) => (
                <div key={s} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-24" />
                </div>
              ))}
            </div>
            <Skeleton className="h-10 w-full rounded-control" />
          </div>
        ))}
      </div>
    </>
  );
}

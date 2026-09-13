import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-3.5 w-72" />
        </div>
        <div className="flex gap-3">
          <Skeleton className="h-[4.25rem] w-36 rounded-control" />
          <Skeleton className="h-[4.25rem] w-56 rounded-control" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((k) => (
          <Skeleton key={k} className="h-[4.75rem] rounded-control" />
        ))}
      </div>
      <Skeleton className="h-24 rounded-control" />
      <Skeleton className="h-56 rounded-control" />
    </>
  );
}

import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";
import { ROLES } from "@/lib/roles";

export default function Home() {
  return (
    <main className="on-dark flex flex-1 flex-col items-center justify-center gap-10 bg-surface px-4 py-16 text-ink sm:gap-14">
      <div className="flex flex-col items-center gap-5 text-center">
        <Wordmark as="h1" className="text-[clamp(5rem,26vw,16rem)]" />
        <p className="max-w-xl text-balance text-base text-ink/70 sm:text-lg">
          Business working capital on the XRP Ledger, with shared and visible risk. Brokers open vaults, lenders fund
          them, borrowers draw fixed tickets, protection sellers guarantee each loan. Everything settles in XRP.
        </p>
        <ButtonLink href="/login" variant="contrast" size="lg" className="min-w-44">
          Log in
        </ButtonLink>
      </div>

      <ul className="grid w-full max-w-4xl grid-cols-2 gap-3 lg:grid-cols-4">
        {ROLES.map((role) => (
          <li key={role.id}>
            <Link
              href="/login"
              className="flex h-full flex-col gap-1 rounded-control border border-ink/20 px-4 py-3.5 transition-colors hover:border-ink/50 hover:bg-ink/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olympic"
            >
              <span className="text-sm font-semibold">{role.label}</span>
              <span className="text-xs text-ink/60">{role.hint}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

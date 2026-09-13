import Link from "next/link";
import { redirect } from "next/navigation";
import { Address } from "@/components/dashboard/address";
import { Nav, type NavItem } from "@/components/dashboard/nav";
import { Button } from "@/components/ui/button";
import { ROLES, type RoleId } from "@/lib/roles";
import { logout } from "@/server/actions";
import { currentUser } from "@/server/auth/session";

const NAV: Record<RoleId, NavItem[]> = {
  broker: [{ href: "/broker", label: "My vaults" }],
  lender: [{ href: "/market", label: "Marketplace" }],
  borrower: [
    { href: "/market", label: "Marketplace" },
    { href: "/borrower", label: "My loans" },
  ],
  "protection-seller": [{ href: "/protect", label: "Protection" }],
};

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const role = ROLES.find((r) => r.id === user.role);

  return (
    <div className="flex flex-1 flex-col bg-surface text-ink">
      <header className="border-b border-ink/10">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4">
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olympic">
              <svg
                viewBox="0 0 270 84"
                className="h-6 w-auto"
                role="img"
                aria-label="AYZE"
              >
                <text
                  x="0"
                  y="76"
                  fontFamily="var(--font-sora), ui-sans-serif, system-ui, sans-serif"
                  fontWeight={700}
                  fontSize={72}
                  letterSpacing="-2.88"
                  fill="currentColor"
                >
                  AYZE
                </text>
                <circle cx="250" cy="64" r="12" fill="currentColor" />
              </svg>
            </Link>
            <Nav items={NAV[user.role]} />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end leading-tight">
              <span className="text-sm font-semibold">{user.company}</span>
              <span className="flex items-center gap-2 text-xs text-ink/60">
                <span className="rounded-full bg-olympic/15 px-2 py-0.5 font-semibold text-olympic-deep">{role?.label}</span>
                <Address value={user.wallet.address} />
              </span>
            </div>
            <form action={logout}>
              <Button type="submit" variant="ghost">
                Log out
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">{children}</main>
    </div>
  );
}

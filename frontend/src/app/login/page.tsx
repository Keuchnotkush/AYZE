import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/ui/wordmark";
import { XRPL_WSS } from "@/server/env";
import { AuthForm } from "./auth-form";

export const metadata: Metadata = { title: "Log in · AYZE" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center bg-surface px-4 py-10 text-ink sm:justify-center">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <Link href="/" className="self-start rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-olympic">
          <Wordmark className="text-3xl" />
        </Link>
        <AuthForm xrplWss={XRPL_WSS} />
      </div>
    </main>
  );
}

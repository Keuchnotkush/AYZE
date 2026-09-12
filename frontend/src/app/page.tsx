import { ButtonLink } from "@/components/ui/button";
import { Wordmark } from "@/components/ui/wordmark";

export default function Home() {
  return (
    <main className="on-dark flex flex-1 flex-col items-center justify-center gap-8 bg-surface px-4 py-16 text-ink sm:gap-12">
      <Wordmark as="h1" className="text-[clamp(5rem,26vw,16rem)]" />
      <ButtonLink href="/login" variant="contrast" size="lg" className="min-w-44">
        Log in
      </ButtonLink>
    </main>
  );
}

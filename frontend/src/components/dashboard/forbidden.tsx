import Link from "next/link";
import { Card } from "@/components/dashboard/stat";

/** Rendered (not thrown) when a page is opened by the wrong role: AYZE_FORBIDDEN_ROLE. */
export function Forbidden({ message }: { message: string }) {
  return (
    <Card title="Access denied">
      <p className="text-sm text-ink/80">
        <span className="font-mono text-xs">AYZE_FORBIDDEN_ROLE</span> — {message}
      </p>
      <Link href="/dashboard" className="text-sm underline underline-offset-4">
        Back to my dashboard
      </Link>
    </Card>
  );
}

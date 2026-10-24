import Link from "next/link";
import type { ReactNode } from "react";

// Shared shell for /privacy and /terms. English only: Google's consent screen
// and the judges read these; the app itself is translated.

export const LEGAL_UPDATED = "October 24, 2026";

/** Set NEXT_PUBLIC_CONTACT_EMAIL on Vercel to show a contact address. */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 text-[15px] leading-relaxed">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
        ← Ledger
      </Link>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
      <div className="mt-8 space-y-4 [&_a]:underline [&_a]:underline-offset-2 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
      <footer className="mt-12 flex gap-4 border-t pt-4 text-sm text-muted-foreground">
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
      </footer>
    </main>
  );
}

export function Contact() {
  return CONTACT_EMAIL ? (
    <>
      {" "}
      or email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
    </>
  ) : null;
}

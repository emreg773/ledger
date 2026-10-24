import type { Metadata } from "next";
import { Contact, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy Policy · Ledger" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Ledger is a prototype built at Cal Hacks 13.0. It helps small business owners understand
        letters from government agencies. This page explains what Ledger collects, who processes it,
        and how to delete it.
      </p>
      <p>
        <strong>
          Please don&apos;t upload documents with unmasked Social Security numbers, EINs or bank account
          numbers.
        </strong>{" "}
        Cover them before taking a photo. Ledger also tries to mask these numbers before saving what it
        read, but that is a safety net, not a guarantee.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your Google account basics:</strong> your name, email address and profile picture,
          from Google sign-in. We don&apos;t get your Google password or access to your Gmail, Drive or
          contacts.
        </li>
        <li>
          <strong>What you tell us:</strong> your name, business name, city and preferred language.
        </li>
        <li>
          <strong>Documents you upload:</strong> the photos or PDFs, and the details Ledger reads from
          them (agency, amounts, deadlines, contact details).
        </li>
        <li>
          <strong>Your chat with Ledger</strong>, the cases it opens, the actions it proposes, and a log
          of what it did (for example, &quot;checked the sender&quot;).
        </li>
        <li>
          <strong>Notification subscriptions:</strong> if you turn on notifications, your browser gives us
          an address to send them to.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to run Ledger for you: to read your documents, explain them, check them against your sandbox
        bank, propose next steps and notify you. We don&apos;t sell your data, show ads, or use it to train
        AI models.
      </p>

      <h2>Who processes it</h2>
      <ul>
        <li>
          <strong>Anthropic</strong> (Claude) reads your documents and chat messages to write
          Ledger&apos;s replies, under Anthropic&apos;s commercial API terms.
        </li>
        <li>
          <strong>Convex</strong> stores your data and files and runs Ledger&apos;s backend.
        </li>
        <li>
          <strong>Vercel</strong> hosts the website.
        </li>
        <li>
          <strong>Google</strong> handles sign-in.
        </li>
        <li>
          <strong>Capital One&apos;s Nessie</strong> hackathon API provides the sandbox bank. It holds
          only made-up accounts and payments, never your real bank details.
        </li>
        <li>
          <strong>Your browser&apos;s push service</strong> (Google, Apple or Mozilla) delivers
          notifications. Notifications contain short summaries, such as the type of letter and an amount,
          never ID or account numbers.
        </li>
      </ul>

      <h2>The sandbox bank</h2>
      <p>
        Ledger doesn&apos;t connect to your real bank. Each account gets a sandbox bank with fake money,
        so you can try approving payments safely. No real money ever moves.
      </p>

      <h2>Keeping and deleting your data</h2>
      <p>
        We keep your data until you delete it. In the app menu, &quot;Start over with demo data&quot;
        deletes your documents, cases and chat, and &quot;Delete my account&quot; deletes everything,
        including your profile and notification subscriptions. Data the processors above handled may
        stay in their systems for a limited time under their own policies.
      </p>

      <h2>Security</h2>
      <p>
        Data is sent over HTTPS, and every request is checked so that you can only see your own data. As
        a hackathon prototype, Ledger hasn&apos;t had a security audit, so please treat it accordingly.
      </p>

      <h2>Children</h2>
      <p>Ledger is for business owners and isn&apos;t meant for anyone under 18.</p>

      <h2>Changes and contact</h2>
      <p>
        If this policy changes, we&apos;ll update the date above. For questions, contact the Ledger team<Contact />.
      </p>
    </LegalPage>
  );
}

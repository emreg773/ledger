import type { Metadata } from "next";
import Link from "next/link";
import { Contact, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms of Service · Ledger" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        Ledger is a prototype built at Cal Hacks 13.0. By signing in, you agree to these terms. If you
        don&apos;t agree, please don&apos;t use Ledger.
      </p>

      <h2>What Ledger is, and isn&apos;t</h2>
      <p>
        Ledger reads letters from government agencies, explains them in your language and suggests next
        steps. <strong>It is not legal, tax or financial advice</strong>, and it doesn&apos;t replace an
        accountant, tax preparer or lawyer. Ledger can misread a document or be wrong. Always check
        amounts, deadlines and phone numbers against the original letter and the agency&apos;s official
        website before you act.
      </p>

      <h2>Payments are simulated</h2>
      <p>
        Ledger uses a sandbox bank with fake money. Approving a payment in Ledger doesn&apos;t pay any
        agency or move any real money. To actually pay or respond to an agency, use the agency&apos;s
        official channels.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You sign in with your own Google account and are responsible for what happens in it.</li>
        <li>Only upload documents you&apos;re allowed to share.</li>
        <li>
          Cover Social Security numbers, EINs and bank account numbers before uploading. See the{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </li>
      </ul>

      <h2>Fair use</h2>
      <p>
        Don&apos;t try to access other people&apos;s data, overload the service, or use Ledger for
        anything illegal. To keep costs under control, Ledger limits how many documents and messages you
        can send per hour, and may pause the service.
      </p>

      <h2>No warranty</h2>
      <p>
        Ledger is provided &quot;as is&quot;, without warranties of any kind. It may be unavailable,
        change, or be shut down at any time, and your data may be deleted when the prototype ends. To the
        extent the law allows, the Ledger team isn&apos;t liable for any loss that comes from using it,
        including missed deadlines, penalties or interest.
      </p>

      <h2>Deleting your account</h2>
      <p>
        You can delete your account and all your data at any time from the app menu, under &quot;Delete
        my account&quot;.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If these terms change, we&apos;ll update the date above. For questions, contact the Ledger team<Contact />.
      </p>
    </LegalPage>
  );
}

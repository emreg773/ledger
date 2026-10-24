"use client";

import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2 } from "lucide-react";
import { LANGUAGES } from "@/convex/shared";
import { Button } from "@/components/ui/button";
import { Chat } from "@/components/chat";
import { backend } from "@/lib/backend";
import { errorMessage } from "@/lib/errors";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// What the one page shows: sign-in → onboarding → chat
// (docs/ledger-step3-B.md, Sections 3 and 4).

const LANGUAGE_KEY = "ledger.language";

/** The language picked before there's an owner: saved choice, else the browser's. */
function useSignedOutLanguage() {
  const [language, setLanguage] = useState("en");
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LANGUAGE_KEY);
    } catch {}
    const browser = navigator.language.slice(0, 2);
    const pick = [saved, browser].find((l) => LANGUAGES.some((x) => x.code === l));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists after mount
    if (pick) setLanguage(pick);
  }, []);
  const choose = (code: string) => {
    setLanguage(code);
    try {
      localStorage.setItem(LANGUAGE_KEY, code);
    } catch {}
  };
  return [language, choose] as const;
}

export function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const owner = useQuery(backend.owners.me, isAuthenticated ? {} : "skip");
  const [language, setLanguage] = useSignedOutLanguage();

  if (isLoading || (isAuthenticated && owner === undefined)) return <Spinner />;

  if (!isAuthenticated) {
    return (
      <I18nProvider language={language}>
        <SignIn language={language} onLanguage={setLanguage} />
      </I18nProvider>
    );
  }
  if (owner === null) {
    return (
      <I18nProvider language={language}>
        <Onboarding language={language} onLanguage={setLanguage} />
      </I18nProvider>
    );
  }
  return (
    <I18nProvider language={owner!.preferredLanguage}>
      <Chat owner={owner!} />
    </I18nProvider>
  );
}

function Spinner() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function LanguageButtons({
  language,
  onLanguage,
  size = "sm",
}: {
  language: string;
  onLanguage: (code: string) => void;
  size?: "sm" | "lg";
}) {
  return (
    <div className={cn("grid grid-cols-3", size === "lg" ? "gap-2" : "gap-1")}>
      {LANGUAGES.map((l) => (
        <Button
          key={l.code}
          type="button"
          variant={l.code === language ? "default" : "outline"}
          className={size === "lg" ? "h-12 text-base" : "h-9"}
          aria-pressed={l.code === language}
          onClick={() => onLanguage(l.code)}
        >
          {l.label}
        </Button>
      ))}
    </div>
  );
}

function SignIn({ language, onLanguage }: { language: string; onLanguage: (c: string) => void }) {
  const { t } = useI18n();
  const { signIn } = useAuthActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function google() {
    setPending(true);
    setError(false);
    try {
      // Come back to the same URL, so a push link (/?case=…) survives sign-in.
      await signIn("google", { redirectTo: window.location.pathname + window.location.search });
    } catch (e) {
      console.error(e);
      setError(true);
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-4 py-10">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Ledger</h1>
        <p className="text-base text-muted-foreground">{t("signIn.pitch")}</p>
      </div>
      <div className="space-y-3">
        <Button className="h-12 w-full text-base" onClick={() => void google()} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <GoogleMark />}
          {t("signIn.google")}
        </Button>
        {error && <p className="text-sm text-destructive">{t("signIn.error")}</p>}
      </div>
      <LanguageButtons language={language} onLanguage={onLanguage} />
      <p className="text-xs text-muted-foreground">{t("privacy.notice")}</p>
    </main>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

function Field({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        maxLength={80}
        required
        className="h-12 w-full rounded-lg border bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
    </label>
  );
}

export function Onboarding({ language, onLanguage }: { language: string; onLanguage: (c: string) => void }) {
  const { t } = useI18n();
  const { signOut } = useAuthActions();
  const completeOnboarding = useMutation(backend.owners.completeOnboarding);
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim() !== "" && businessName.trim() !== "";

  async function submit() {
    if (!ready) return;
    setPending(true);
    setError(null);
    try {
      // owners.me updates on success, and App switches to the chat.
      await completeOnboarding({
        name: name.trim(),
        businessName: businessName.trim(),
        preferredLanguage: language,
      });
    } catch (e) {
      setError(errorMessage(t, e, "onboarding.error"));
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("onboarding.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("onboarding.subtitle")}</p>
      </div>
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-1.5">
          <span className="text-sm font-medium">{t("onboarding.language")}</span>
          <LanguageButtons language={language} onLanguage={onLanguage} size="lg" />
        </div>
        <Field label={t("onboarding.name")} value={name} onChange={setName} autoComplete="name" />
        <Field
          label={t("onboarding.business")}
          value={businessName}
          onChange={setBusinessName}
          autoComplete="organization"
        />
        <p className="text-xs text-muted-foreground">{t("onboarding.area")}</p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="h-12 w-full text-base" disabled={!ready || pending}>
          {pending && <Loader2 className="animate-spin" />}
          {t("onboarding.submit")}
        </Button>
      </form>
      <Button variant="link" className="self-center" onClick={() => void signOut()}>
        {t("menu.signOut")}
      </Button>
    </main>
  );
}

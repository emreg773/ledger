"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useAuthActions } from "@convex-dev/auth/react";
import {
  ArrowUp,
  BellRing,
  Camera,
  Check,
  ChevronDown,
  Globe,
  Landmark,
  Loader2,
  Phone,
  Plus,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { LANGUAGES } from "@/convex/shared";
import { docTypeName, useI18n, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// What signed-out visitors see at /: the pitch, a played-back demo chat, and
// Google sign-in. Dark on purpose, unlike the cream app behind it.

// Questions owners actually type, each in its own language (not translated).
const PROMPTS = [
  "¿Qué dice esta carta del IRS?",
  "这封信是什么意思？",
  "Lá thư này nói gì vậy?",
  "이 편지 진짜예요, 사기예요?",
  "Bu mektup ne diyor?",
  "Do I have to pay this?",
];

const DOC_TYPES = [
  "IRS_CP14",
  "IRS_CP504",
  "IRS_972CG",
  "COUNTY_HEALTH_INSPECTION",
  "CITY_FINE",
  "CITY_CODE_VIOLATION",
  "CITY_LICENSE_LATE_NOTICE",
];

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- matchMedia only exists after mount
    setReduced(query.matches);
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return reduced;
}

/** True once the element has scrolled into view; stays true. */
function useInView<T extends Element>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const [ref, inView] = useInView<HTMLDivElement>(0.15);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn("landing-reveal", inView && "is-visible", className)}
    >
      {children}
    </div>
  );
}

/** Types each prompt, holds it, erases it, moves on. */
function useTypewriter(lines: string[], reduced: boolean) {
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);
  const [erasing, setErasing] = useState(false);
  const line = lines[index];

  useEffect(() => {
    if (reduced) {
      const id = setTimeout(() => setIndex((i) => (i + 1) % lines.length), 3200);
      return () => clearTimeout(id);
    }
    const chars = Array.from(line);
    let delay = erasing ? 28 : 55;
    if (!erasing && length === chars.length) delay = 1900;
    if (erasing && length === 0) delay = 350;
    const id = setTimeout(() => {
      if (!erasing && length === chars.length) setErasing(true);
      else if (erasing && length === 0) {
        setErasing(false);
        setIndex((i) => (i + 1) % lines.length);
      } else setLength((n) => n + (erasing ? -1 : 1));
    }, delay);
    return () => clearTimeout(id);
  }, [line, length, erasing, reduced, lines.length]);

  return reduced ? line : Array.from(line).slice(0, length).join("");
}

function useGoogleSignIn() {
  const { signIn } = useAuthActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  async function start() {
    if (pending) return;
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
  return { pending, error, start: () => void start() };
}

/** The phone's browser chrome matches the black page, not the cream app. */
function useThemeColor(color: string) {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) return;
    const previous = meta.content;
    meta.content = color;
    return () => {
      meta.content = previous;
    };
  }, [color]);
}

export function Landing({
  language,
  onLanguage,
}: {
  language: string;
  onLanguage: (code: string) => void;
}) {
  const { t } = useI18n();
  const google = useGoogleSignIn();
  const reduced = usePrefersReducedMotion();
  useThemeColor("#000000");

  return (
    <div className="landing flex min-h-dvh flex-1 flex-col overflow-x-clip bg-black text-[#f4f4f5] antialiased">
      <Hero
        language={language}
        onLanguage={onLanguage}
        google={google}
        reduced={reduced}
      />
      <DocTypes />
      <Demo reduced={reduced} />
      <HowItWorks />
      <Features />
      <Languages language={language} onLanguage={onLanguage} />
      <FinalCta google={google} />
      <footer className="border-t border-white/5 px-4 py-10 text-sm text-[#9a9aa2]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-md space-y-3">
            <Brand />
            <p className="text-xs leading-relaxed text-[#5f5f68]">{t("privacy.notice")}</p>
          </div>
          <div className="flex flex-col gap-3 md:items-end">
            <nav className="flex gap-5 [&_a]:transition-colors [&_a:hover]:text-white">
              <Link href="/privacy">{t("legal.privacy")}</Link>
              <Link href="/terms">{t("legal.terms")}</Link>
            </nav>
            <p className="text-xs text-[#5f5f68]">{t("landing.built")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

type Google = ReturnType<typeof useGoogleSignIn>;

function Brand() {
  return (
    <span className="flex items-center gap-2.5">
      <Image src="/icons/icon-192.png" alt="" width={30} height={30} className="rounded-lg" />
      <b className="text-lg font-medium tracking-wide text-white">Ledger</b>
    </span>
  );
}

function LanguagePicker({
  language,
  onLanguage,
}: {
  language: string;
  onLanguage: (code: string) => void;
}) {
  const { t } = useI18n();
  const current = LANGUAGES.find((l) => l.code === language) ?? LANGUAGES[1];
  return (
    <label className="relative flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] pr-3 pl-3 text-sm text-[#d4d4d8] transition-colors hover:border-white/20 hover:text-white">
      <Globe className="size-4" />
      <span>{current.label}</span>
      <ChevronDown className="size-3.5 text-[#5f5f68]" />
      <select
        value={current.code}
        onChange={(e) => onLanguage(e.target.value)}
        aria-label={t("chat.language")}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Hero({
  language,
  onLanguage,
  google,
  reduced,
}: {
  language: string;
  onLanguage: (code: string) => void;
  google: Google;
  reduced: boolean;
}) {
  const { t } = useI18n();
  const typed = useTypewriter(PROMPTS, reduced);

  return (
    <section className="landing-horizon relative flex min-h-dvh flex-col">
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 pt-5 sm:px-6">
        <Brand />
        <div className="flex items-center gap-2">
          <LanguagePicker language={language} onLanguage={onLanguage} />
          <button
            type="button"
            onClick={google.start}
            className="hidden h-10 rounded-full bg-white px-4 text-sm font-medium text-black transition-colors hover:bg-white/85 sm:block"
          >
            {t("landing.signIn")}
          </button>
        </div>
      </header>

      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-4 pt-16 pb-[16vh] text-center sm:px-6">
        <p className="landing-rise mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs text-[#c4c4cc] sm:text-sm">
          <Sparkles className="size-3.5 text-[#f0b44c]" />
          {t("landing.eyebrow")}
        </p>
        <h1
          className="landing-rise text-[2.6rem] leading-[1.04] font-medium tracking-[-0.035em] text-balance sm:text-6xl md:text-7xl"
          style={{ animationDelay: "80ms" }}
        >
          {t("landing.title")}
        </h1>
        <p
          className="landing-rise mt-6 max-w-xl text-base leading-relaxed text-pretty text-[#9a9aa2] sm:text-lg"
          style={{ animationDelay: "160ms" }}
        >
          {t("signIn.pitch")}
        </p>

        {/* The composer from the app, as the call to action. */}
        <button
          type="button"
          onClick={google.start}
          aria-label={t("signIn.google")}
          className="landing-rise group mt-10 flex w-full max-w-[640px] items-center gap-3 rounded-[28px] border border-[#2a2a2e] bg-[#0c0c0e]/90 py-2.5 pr-2.5 pl-4 text-left shadow-[0_20px_80px_-20px_rgba(61,63,224,0.55)] backdrop-blur transition-[border-color,box-shadow] hover:border-[#3a3a40] hover:shadow-[0_20px_90px_-15px_rgba(81,83,240,0.7)]"
          style={{ animationDelay: "240ms" }}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-full text-[#9a9aa2] transition-colors group-hover:text-white">
            <Plus className="size-5" />
          </span>
          <span className="min-w-0 flex-1 truncate text-base text-[#d4d4d8] sm:text-[17px]" aria-hidden="true">
            {typed}
            <span className="landing-caret ml-px inline-block h-[1.1em] w-[2px] translate-y-[0.2em] bg-[#f4f4f5]" />
          </span>
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#3d3fe0] text-white transition-colors group-hover:bg-[#5153f0]">
            {google.pending ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" strokeWidth={2.4} />}
          </span>
        </button>

        <div
          className="landing-rise mt-6 flex flex-col items-center gap-3"
          style={{ animationDelay: "320ms" }}
        >
          <GoogleButton google={google} />
          <p className="text-xs text-[#5f5f68]">{t("landing.ctaNote")}</p>
          {google.error && <p className="text-sm text-[#f87171]">{t("signIn.error")}</p>}
        </div>
      </div>

      <a
        href="#demo"
        aria-label={t("landing.demoEyebrow")}
        className="relative z-10 mx-auto mb-6 grid size-10 place-items-center rounded-full text-[#9a9aa2] transition-colors hover:text-white"
      >
        <ChevronDown className="landing-bob size-5" />
      </a>
    </section>
  );
}

function GoogleButton({ google, large }: { google: Google; large?: boolean }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={google.start}
      disabled={google.pending}
      className={cn(
        "inline-flex items-center justify-center gap-2.5 rounded-full bg-white font-medium text-black transition-[background-color,transform] hover:bg-white/85 active:translate-y-px disabled:opacity-60",
        large ? "h-14 px-7 text-base" : "h-12 px-6 text-[15px]",
      )}
    >
      {google.pending ? <Loader2 className="size-5 animate-spin" /> : <GoogleMark />}
      {t("signIn.google")}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5">
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.7 2.3 2.4 6.6 2.4 12s4.3 9.7 9.6 9.7c5.5 0 9.2-3.9 9.2-9.4 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

function DocTypes() {
  const { t } = useI18n();
  // Two copies side by side, so the strip loops without a seam.
  const row = DOC_TYPES.map((d) => docTypeName(t, d));
  return (
    <section className="border-y border-white/5 bg-[#050505] py-7">
      <p className="mb-5 px-4 text-center text-xs tracking-[0.18em] text-[#5f5f68] uppercase">
        {t("landing.docsLabel")}
      </p>
      <div className="landing-marquee-mask overflow-hidden">
        <div className="landing-marquee flex w-max gap-3">
          {[...row, ...row].map((name, i) => (
            <span
              key={i}
              aria-hidden={i >= row.length}
              className="flex shrink-0 items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.02] px-4 py-2 text-sm whitespace-nowrap text-[#c4c4cc]"
            >
              <Landmark className="size-3.5 text-[#f0b44c]" />
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// The demo plays these steps in order once it scrolls into view.
const DEMO_STEPS = ["letter", "question", "read", "verify", "bank", "reply", "action"] as const;
const DEMO_TIMING = [0, 650, 1400, 2200, 3000, 3900, 4800];

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="mb-4 text-xs tracking-[0.18em] text-[#f0b44c] uppercase">{eyebrow}</p>
      <h2 className="text-3xl leading-tight font-medium tracking-[-0.03em] text-balance sm:text-5xl">
        {title}
      </h2>
    </div>
  );
}

function Demo({ reduced }: { reduced: boolean }) {
  const { t } = useI18n();
  const [ref, inView] = useInView<HTMLDivElement>(0.3);
  const [step, setStep] = useState(-1);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- no animation: show the whole chat
      setStep(DEMO_STEPS.length - 1);
      return;
    }
    const ids = DEMO_TIMING.map((ms, i) => setTimeout(() => setStep(i), ms));
    return () => ids.forEach(clearTimeout);
  }, [inView, reduced]);

  const shown = (name: (typeof DEMO_STEPS)[number]) => step >= DEMO_STEPS.indexOf(name);
  const done = (name: (typeof DEMO_STEPS)[number]) => step > DEMO_STEPS.indexOf(name);

  return (
    <section id="demo" className="relative scroll-mt-4 px-4 py-24 sm:px-6 sm:py-32">
      <Reveal>
        <SectionTitle eyebrow={t("landing.demoEyebrow")} title={t("landing.demoTitle")} />
      </Reveal>

      <div ref={ref} className="relative mx-auto mt-14 max-w-2xl">
        <div className="landing-demo-glow pointer-events-none absolute -inset-x-10 -inset-y-16 -z-0" aria-hidden="true" />
        <div className="relative overflow-hidden rounded-3xl border border-[#1c1c1f] bg-[#050505]/95 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-[#1c1c1f] px-5 py-3.5">
            <span className="size-2.5 rounded-full bg-[#2a2a2e]" />
            <span className="size-2.5 rounded-full bg-[#2a2a2e]" />
            <span className="size-2.5 rounded-full bg-[#2a2a2e]" />
            <span className="ml-3 text-sm text-[#5f5f68]">Ledger</span>
          </div>

          <div className="flex min-h-[540px] flex-col gap-4 p-4 sm:p-6">
            {/* The owner's message: a photo of the letter and a question. */}
            <div className={cn("landing-pop ml-auto w-[min(260px,78%)]", shown("letter") && "is-shown")}>
              <Letter />
            </div>
            <div
              className={cn(
                "landing-pop ml-auto max-w-[80%] rounded-3xl rounded-br-lg bg-[#1b1b1f] px-4 py-2.5 text-[15px]",
                shown("question") && "is-shown",
              )}
            >
              {t("landing.demoQuestion")}
            </div>

            <div className="mt-1 space-y-2">
              {(["read", "verify", "bank"] as const).map((name) => (
                <div
                  key={name}
                  className={cn(
                    "landing-pop flex items-center gap-2.5 text-sm text-[#9a9aa2]",
                    shown(name) && "is-shown",
                  )}
                >
                  {done(name) ? (
                    <span className="grid size-4 place-items-center rounded-full bg-[#4ade80]/15">
                      <Check className="size-3 text-[#4ade80]" strokeWidth={3} />
                    </span>
                  ) : (
                    <span className="grid size-4 place-items-center">
                      <span className="size-2 animate-pulse rounded-full bg-[#fbbf24]" />
                    </span>
                  )}
                  {t(`landing.demoTool.${name}` as MessageKey)}
                </div>
              ))}
            </div>

            <div className={cn("landing-pop space-y-3", shown("reply") && "is-shown")}>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#4ade80]/10 px-2.5 py-1 text-xs font-medium text-[#4ade80]">
                <ShieldCheck className="size-3.5" />
                {t("verify.verified")} · IRS
              </span>
              <p className="text-[15px] leading-relaxed text-[#e4e4e7]">{t("landing.demoReply")}</p>
            </div>

            <div
              className={cn(
                "landing-pop rounded-2xl border border-[#2a2a2e] bg-[#101012] p-4",
                shown("action") && "is-shown",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{t("landing.demoPay")}</p>
                  <p className="mt-0.5 text-sm text-[#9a9aa2]">{t("action.from", { last4: "4821" })}</p>
                </div>
                <span className="shrink-0 font-mono text-lg tabular-nums">$1,284.00</span>
              </div>
              <div className="mt-4 flex gap-2">
                <span className="flex h-10 flex-1 items-center justify-center rounded-xl bg-[#3d3fe0] text-sm font-medium">
                  {t("action.approve")}
                </span>
                <span className="flex h-10 flex-1 items-center justify-center rounded-xl border border-[#2a2a2e] text-sm text-[#9a9aa2]">
                  {t("action.reject")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A photo of an IRS notice, drawn: real letters stay in English, that's the point. */
function Letter() {
  return (
    <div className="-rotate-2 rounded-xl bg-[#f7f2e8] p-3.5 font-sans text-[#26211c] shadow-[0_12px_40px_-10px_rgba(0,0,0,0.8)]">
      <div className="flex items-center justify-between border-b border-[#26211c]/15 pb-2">
        <div className="text-[8px] leading-tight font-semibold uppercase">
          Department of the Treasury
          <br />
          Internal Revenue Service
        </div>
        <div className="text-right font-mono text-[9px] font-bold">CP14</div>
      </div>
      <p className="mt-2 text-[11px] font-bold">You have unpaid taxes</p>
      <div className="mt-2 space-y-1">
        <div className="h-1 w-full rounded bg-[#26211c]/15" />
        <div className="h-1 w-[90%] rounded bg-[#26211c]/15" />
        <div className="h-1 w-[70%] rounded bg-[#26211c]/15" />
      </div>
      <div className="mt-2.5 flex items-end justify-between rounded-md bg-[#26211c]/[0.06] px-2 py-1.5">
        <div className="text-[8px] uppercase">
          Amount due
          <div className="font-mono text-[12px] font-bold">$1,284.00</div>
        </div>
        <div className="text-right text-[8px] uppercase">
          Pay by
          <div className="font-mono text-[10px] font-bold">Nov 18, 2026</div>
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  { key: "snap", Icon: Camera },
  { key: "read", Icon: Sparkles },
  { key: "act", Icon: Check },
] as const;

function HowItWorks() {
  const { t } = useI18n();
  return (
    <section className="border-t border-white/5 px-4 py-24 sm:px-6 sm:py-32">
      <Reveal>
        <SectionTitle eyebrow={t("landing.howEyebrow")} title={t("landing.howTitle")} />
      </Reveal>
      <div className="mx-auto mt-16 grid max-w-5xl gap-4 md:grid-cols-3">
        {STEPS.map(({ key, Icon }, i) => (
          <Reveal key={key} delay={i * 110}>
            <div className="group relative h-full overflow-hidden rounded-3xl border border-[#1c1c1f] bg-[#0a0a0b] p-7 transition-colors hover:border-[#2a2a2e]">
              <span className="absolute top-5 right-6 font-mono text-5xl font-medium text-white/[0.05] transition-colors group-hover:text-[#f0b44c]/15">
                0{i + 1}
              </span>
              <span className="grid size-11 place-items-center rounded-2xl bg-white/[0.05] text-[#f0b44c]">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-6 text-xl font-medium tracking-tight">
                {t(`landing.step.${key}.title` as MessageKey)}
              </h3>
              <p className="mt-2 leading-relaxed text-[#9a9aa2]">{t(`landing.step.${key}.body` as MessageKey)}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

const FEATURES = [
  { key: "scam", Icon: ShieldCheck, wide: true },
  { key: "paid", Icon: Landmark, wide: false },
  { key: "pay", Icon: Check, wide: false },
  { key: "call", Icon: Phone, wide: false },
  { key: "remind", Icon: BellRing, wide: false },
  { key: "memory", Icon: Workflow, wide: true },
] as const;

function Features() {
  const { t } = useI18n();
  return (
    <section className="relative px-4 py-24 sm:px-6 sm:py-32">
      <Reveal>
        <SectionTitle eyebrow={t("landing.featuresEyebrow")} title={t("landing.featuresTitle")} />
      </Reveal>
      <div className="mx-auto mt-16 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ key, Icon, wide }, i) => (
          <Reveal key={key} delay={(i % 3) * 90} className={cn(wide && "lg:col-span-2")}>
            <div className="landing-card group relative h-full overflow-hidden rounded-3xl border border-[#1c1c1f] bg-[#0a0a0b] p-7">
              <Icon className="size-6 text-[#f0b44c]" />
              <h3 className="mt-8 text-lg font-medium tracking-tight">
                {t(`landing.feature.${key}.title` as MessageKey)}
              </h3>
              <p className="mt-2 text-[15px] leading-relaxed text-[#9a9aa2]">
                {t(`landing.feature.${key}.body` as MessageKey)}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Languages({
  language,
  onLanguage,
}: {
  language: string;
  onLanguage: (code: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="border-t border-white/5 px-4 py-24 sm:px-6 sm:py-32">
      <Reveal>
        <SectionTitle eyebrow={t("landing.languagesEyebrow")} title={t("landing.languagesTitle")} />
        <p className="mx-auto mt-5 max-w-xl text-center leading-relaxed text-[#9a9aa2]">
          {t("landing.languagesBody")}
        </p>
      </Reveal>
      <Reveal delay={120}>
        <div className="mx-auto mt-14 flex max-w-6xl flex-wrap justify-center gap-x-8 gap-y-3 sm:gap-x-10">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              lang={l.code}
              aria-pressed={l.code === language}
              onClick={() => onLanguage(l.code)}
              className={cn(
                "text-3xl font-medium tracking-tight transition-colors sm:text-5xl",
                l.code === language ? "text-white" : "text-white/20 hover:text-white/60",
              )}
            >
              {l.label}
            </button>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

function FinalCta({ google }: { google: Google }) {
  const { t } = useI18n();
  return (
    <section className="landing-horizon relative overflow-hidden px-4 pt-28 pb-36 text-center sm:px-6 sm:pt-36 sm:pb-44">
      <Reveal className="relative z-10 mx-auto max-w-3xl">
        <h2 className="text-4xl leading-[1.05] font-medium tracking-[-0.035em] text-balance sm:text-6xl">
          {t("landing.finalTitle")}
        </h2>
        <p className="mx-auto mt-5 max-w-md text-[#9a9aa2] sm:text-lg">{t("landing.finalBody")}</p>
        <div className="mt-10 flex flex-col items-center gap-3">
          <GoogleButton google={google} large />
          {google.error && <p className="text-sm text-[#f87171]">{t("signIn.error")}</p>}
          <p className="mt-2 text-xs text-[#5f5f68]">{t("landing.disclaimer")}</p>
        </div>
      </Reveal>
    </section>
  );
}

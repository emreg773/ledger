"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Menu } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import { LANGUAGES } from "@/convex/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { backend } from "@/lib/backend";
import { errorMessage } from "@/lib/errors";
import { useI18n } from "@/lib/i18n";
import type { usePush } from "@/lib/push";

// Header menu (docs/ledger-step3-B.md, Section 4): language, notifications,
// start over, delete account, sign out.

type Confirm = "reset" | "delete" | null;

export function AppMenu({ owner, push }: { owner: Doc<"owners">; push: ReturnType<typeof usePush> }) {
  const { t } = useI18n();
  const { signOut } = useAuthActions();
  const setLanguage = useMutation(backend.owners.setLanguage);
  const sendTest = useMutation(backend.push.sendTest);
  const resetMyData = useMutation(backend.owners.resetMyData);
  const deleteMyAccount = useMutation(backend.owners.deleteMyAccount);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const deleteWord = t("menu.deleteWord");

  async function runConfirmed() {
    setPending(true);
    try {
      if (confirm === "reset") {
        await resetMyData({});
      } else if (confirm === "delete") {
        await deleteMyAccount({});
        await signOut();
      }
      setConfirm(null);
    } catch (e) {
      setNote(errorMessage(t, e, "action.error"));
    } finally {
      setPending(false);
      setTyped("");
    }
  }

  async function toggleNotifications() {
    setNote(null);
    try {
      if (push.state === "on") await push.disable();
      else await push.enable();
    } catch (e) {
      console.error(e);
      setNote(t("push.failed"));
    }
  }

  const notificationsLabel =
    push.state === "on"
      ? t("menu.notificationsOff")
      : push.state === "denied"
        ? t("push.deniedTitle")
        : t("menu.notificationsOn");
  const canToggle = push.state === "on" || push.state === "default";

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon-lg" aria-label={t("menu.open")} />}
        >
          <Menu />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("chat.language")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={owner.preferredLanguage}
              onValueChange={(language: string) => void setLanguage({ language })}
            >
              {LANGUAGES.map((l) => (
                <DropdownMenuRadioItem key={l.code} value={l.code}>
                  {l.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          {push.state !== "unsupported" && push.state !== "loading" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("menu.notifications")}</DropdownMenuLabel>
                {push.state === "needs_install" ? (
                  <DropdownMenuItem disabled>{t("push.installTitle")}</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    disabled={!canToggle || push.busy}
                    onClick={() => void toggleNotifications()}
                  >
                    {notificationsLabel}
                  </DropdownMenuItem>
                )}
                {push.state === "on" && (
                  <DropdownMenuItem
                    onClick={() => {
                      setNote(null);
                      sendTest({}).catch((e) => setNote(errorMessage(t, e, "push.failed")));
                    }}
                  >
                    {t("menu.sendTest")}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setConfirm("reset")}>{t("menu.reset")}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirm("delete")}>
              {t("menu.delete")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void signOut()}>{t("menu.signOut")}</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {note && (
        <p role="status" className="absolute top-full right-3 z-10 mt-1 rounded-md bg-popover px-2 py-1 text-xs shadow">
          {note}
        </p>
      )}

      <AlertDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setConfirm(null);
            setTyped("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "delete" ? t("menu.deleteTitle") : t("menu.resetTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete" ? t("menu.deleteBody", { word: deleteWord }) : t("menu.resetBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirm === "delete" && (
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label={t("menu.deleteBody", { word: deleteWord })}
              autoCapitalize="characters"
              className="h-11 w-full rounded-lg border bg-background px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("action.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === "delete" ? "destructive" : "default"}
              disabled={
                pending ||
                (confirm === "delete" && typed.trim().toLowerCase() !== deleteWord.toLowerCase())
              }
              onClick={() => void runConfirmed()}
            >
              {confirm === "delete" ? t("menu.deleteConfirm") : t("menu.resetConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

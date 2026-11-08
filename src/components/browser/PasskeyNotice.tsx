
import { KeyRound, X } from "lucide-react";
import type { PasskeyWall } from "../../../shared/passkey-wall";
import { PASSKEY_HELP_URL, openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";


/** A sign-in stopped at a passkey this browser cannot reach, and the ways that work instead, best first. */
export function PasskeyNotice({ wall, botName, onDismiss }: { wall: PasskeyWall; botName: string; onDismiss: () => void }) {
  const { dispatch } = useStore();
  const provider = wall === "google" ? "Google" : "Microsoft";
  return (
    <section role="status" aria-label={t("browser.passkey.title")} className="shrink-0 border-b border-hairline/30 bg-inset/60 px-3 py-2.5 text-[12px] leading-relaxed text-ink-secondary">
      <div className="flex items-start gap-2">
        <KeyRound size={14} className="mt-0.5 shrink-0 text-accent-text" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">{t("browser.passkey.title")}</p>
          <p>{t("browser.passkey.body", { provider })}</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4">
            <li>
              {t(wall === "google" ? "browser.passkey.appsGoogle" : "browser.passkey.appsMicrosoft", { name: botName })}{" "}
              <button type="button" className="text-accent-text underline" onClick={() => dispatch({ type: "togglePlugins", open: true, surface: "apps" })}>{t("browser.passkey.connect")}</button>
            </li>
            <li>{t(wall === "google" ? "browser.passkey.otherWayGoogle" : "browser.passkey.otherWayMicrosoft")}</li>
          </ol>
          <button type="button" className="mt-1 text-accent-text underline" onClick={() => void openExternalLink(PASSKEY_HELP_URL)}>{t("browser.passkey.learnMore")}</button>
        </div>
        <button type="button" className="rounded-md p-1 text-ink-tertiary hover:bg-inset hover:text-ink" aria-label={t("browser.passkey.dismiss")} onClick={onDismiss}><X size={14} /></button>
      </div>
    </section>
  );
}

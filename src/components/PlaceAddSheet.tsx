// ＋ at the end of the rail: one sheet of choices. A new organization on the Team plan the person pays for (when they run
// one), buy a Cloud (the buying sheet: another Cloud right here, or the first one on this computer's own sheet), or add a
// server of the person's own by pasting its pairing link.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import type { RailAddChoices } from "../../electron/rail-places.mjs";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { BackLink, Heading } from "./account-parts";

/** A server's pairing link, pasted here: main checks it and asks "Connect to <host>?" itself, then opens it. The sheet
 * stays open when the person cancels, and says so when the link isn't one. `connect`: a server of theirs that signed in
 * with their account, not connected to this app yet. */
export function OwnServerLink({ onBack, onConnected, connect = null }: { onBack: (() => void) | null; onConnected: () => void; connect?: { name: string } | null }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const pasted = link.trim();
    if (!pasted || busy) return;
    track("rail_add", { step: "link" });
    setBusy(true);
    setFailed(false);
    try {
      if (await window.ogb?.workspaces?.add?.("link", pasted) !== false) onConnected();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return <form data-place-add={connect ? "connect-server" : "own-server"} onSubmit={(event) => void submit(event)} className="flex flex-col gap-4 px-[30px] pb-[26px] pt-7">
    {onBack && <div><BackLink label={t("rail.back")} onClick={onBack} /></div>}
    <Heading title={connect ? t("rail.connectTitle", { name: connect.name }) : t("rail.own")} sub={t(connect ? "rail.connectPasteLede" : "rail.pasteLede")} />
    <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink">{t("rail.paste")}
      <input data-autofocus data-own-server-link value={link} disabled={busy} onChange={(event) => { setLink(event.target.value); setFailed(false); }}
        placeholder="https://" autoCapitalize="none" autoCorrect="off" autoComplete="off" spellCheck={false} aria-invalid={failed || undefined}
        className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] font-normal text-ink outline-none focus:border-accent/50" />
    </label>
    {failed && <p role="alert" className="text-[13px] text-danger">{t("rail.linkFailed")}</p>}
    <div><button type="submit" disabled={busy || !link.trim()} className="ui-button ui-button-primary inline-flex items-center gap-2">
      {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}{t("rail.connect")}
    </button></div>
  </form>;
}


const FOCUSABLE = "button:not([disabled]):not([tabindex='-1']), input:not([disabled]):not([tabindex='-1']), [href], [tabindex='0']";

/** The sheet over the app, like the buying sheet's: Escape and Close close it, Tab stays in it, focus goes back after. */
export function RailSheet({ wide = false, focusKey, onClose, children }: { wide?: boolean; focusKey: string; onClose: () => void; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const controls = [...(sheet.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      if (!controls.length) return;
      event.preventDefault();
      const at = controls.indexOf(document.activeElement as HTMLElement);
      controls[at === -1 ? 0 : (at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]!.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); if (opener?.isConnected) opener.focus(); };
  }, [onClose]);
  useEffect(() => {
    if (sheet.current?.contains(document.activeElement) && document.activeElement !== sheet.current) return;
    (sheet.current?.querySelector<HTMLElement>("[data-autofocus]") ?? sheet.current?.querySelector<HTMLElement>("#cloud-add-title"))?.focus();
  }, [focusKey]);
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div ref={sheet} role="dialog" aria-modal="true" aria-labelledby="cloud-add-title" data-place-add-sheet tabIndex={-1}
      className={cn("animate-pop-in relative max-h-full w-full overflow-y-auto overscroll-contain rounded-2xl border border-hairline/70 bg-panel shadow-2xl outline-none", wide ? "max-w-[900px]" : "max-w-[560px]")}>
      <button type="button" onClick={onClose} aria-label={t("common.close")} className="ui-icon-button absolute end-3.5 top-3.5 z-10"><X size={18} /></button>
      {children}
    </div>
  </div>;
}

export function PlaceAddSheet({ connect = null, onClose }: { choices?: RailAddChoices; connect?: { name: string } | null; onClose: () => void; onAccount?: () => void }) {
  return <RailSheet focusKey="server" onClose={onClose}>
    <OwnServerLink onBack={null} onConnected={onClose} connect={connect} />
  </RailSheet>;
}

import { t } from "@/lib/i18n";
import { localDesktopPage } from "./onboarding/WelcomeGate";

export type SchedulePlace = { kind: "server" } | { kind: "local" };

export function schedulePlace({ local }: { local: boolean }): SchedulePlace {
  if (!local) return { kind: "server" };
  return { kind: "local" };
}

export function RoutineScheduleNote() {
  const local = localDesktopPage() && window.ogb?.remoteClient?.active !== true;
  const place = schedulePlace({ local });
  return (
    <p data-routine-schedule-note={place.kind} className="text-[11px] leading-relaxed text-ink-secondary">
      {place.kind === "server" ? t("routines.scheduleNote.server") : t("routines.scheduleNote.local")}
    </p>
  );
}

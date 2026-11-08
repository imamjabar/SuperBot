import { t } from "@/lib/i18n";

export function JobViewFooter({ onBackToMain }: { onBackToMain: () => void }) {
  return (
    <div
      data-testid="job-view-footer"
      className="pointer-events-auto mx-5 mb-4 flex items-center justify-between gap-3 rounded-2xl border border-hairline/60 bg-raised px-4 py-3"
    >
      <p className="text-small text-ink-secondary">{t("chat.jobView.readOnly")}</p>
      <button
        type="button"
        onClick={onBackToMain}
        className="shrink-0 rounded-full bg-accent px-3 py-1 text-small font-medium text-white hover:bg-accent/90"
      >
        {t("chat.backToMainThread")}
      </button>
    </div>
  );
}

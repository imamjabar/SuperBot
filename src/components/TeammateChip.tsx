// A message a bot passed to a person on a Team Cloud (message_person): the "Told Bob" chip in the conversation that
// asked, with what was passed under it.
import { cn } from "@/lib/cn";
import type { Message } from "@/state/store";
import { t } from "@/lib/i18n";

const initial = (name: string) => name.trim().charAt(0).toUpperCase() || "?";
const HUES = ["bg-[#5B8DEF]", "bg-[#E0745B]", "bg-[#4FAF7F]", "bg-[#B26BD9]", "bg-[#D9A23B]", "bg-[#3BA7B8]"];
const hueOf = (email: string) => HUES[[...email].reduce((sum, char) => sum + char.charCodeAt(0), 0) % HUES.length];

export function PersonFace({ person, size = 18 }: { person: { email?: string; name: string }; size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none text-white", hueOf(person.email ?? person.name))}
    >
      {initial(person.name)}
    </span>
  );
}

export function TeammateChip({ message }: { message: Message }) {
  const relay = message.relay;
  if (!relay || relay.kind !== "told") return null;
  const passed = message.tool?.output?.trim();
  return (
    <div className="flex flex-col items-start gap-1" data-relay="told">
      <span className="ui-pill" title={t("relay.toldHint", { name: relay.name })}>
        <PersonFace person={{ email: relay.email, name: relay.name }} size={16} />
        <span className="max-w-[480px] truncate">{t("relay.told", { name: relay.name })}</span>
      </span>
      {passed && <p className="max-w-[min(38rem,100%)] rounded-xl border border-hairline/40 bg-panel px-3 py-1.5 text-[13px] whitespace-pre-wrap break-words text-ink-secondary">{passed}</p>}
    </div>
  );
}

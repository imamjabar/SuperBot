import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { ReplyBlocks } from "@/components/ReplyBlocks";
import { SIMPLE_BUBBLE_TEXT } from "@/components/chat-bubble";
import { cn } from "@/lib/cn";
import { formattedReplyWidth, splitReplyBlocks } from "@/lib/formatted-reply";
import { ADVANCED_MODE_KEY } from "@/lib/interface-mode";
import { applySkinChoice, readSkinChoice } from "@/lib/skins";
import { applyFont, readFont } from "@/lib/fonts";
import { applyChatWidth, readChatWidth } from "@/lib/chat-width";
import "@/styles.css";

declare global {
  interface Window { __phoneReady?: boolean }
}

const params = new URLSearchParams(location.search);
const advanced = params.get("mode") !== "simple";
const text = params.get("text") ?? "";
localStorage.setItem(ADVANCED_MODE_KEY, advanced ? "1" : "0");
applySkinChoice(readSkinChoice());
applyFont(readFont());
applyChatWidth(readChatWidth());

const render = (block: string) => <ChatMarkdown text={block} />;

function Reply() {
  if (!advanced) {
    return (
      <div data-chat-bubble="simple" className={cn("w-full min-w-0 text-ink", SIMPLE_BUBBLE_TEXT)}>
        <ReplyBlocks blocks={splitReplyBlocks(text)} citation={{ messageId: "phone-check", ownerType: "bot", ownerId: "phone-check", threadId: "phone-check" }} render={render} />
      </div>
    );
  }
  return (
    <div data-chat-bubble="" className={cn("w-fit min-w-0 max-w-[min(var(--chat-bubble-max),var(--chat-bubble-pct))] rounded-2xl text-[15px] leading-relaxed", formattedReplyWidth(text), "px-1 text-ink")}>
      <div>{render(text)}</div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div data-phone-scroller className="glass-scroller h-dvh overflow-x-hidden overflow-y-auto overscroll-y-contain px-5">
      <div className="glass-scroller-content chat-column relative flex w-full flex-col gap-3" role="log">
        <div className="group flex w-full flex-col items-start">
          <div className="flex w-full items-center gap-1.5 justify-start">
            <Reply />
          </div>
        </div>
      </div>
    </div>
  </StrictMode>,
);

void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => { window.__phoneReady = true; })));

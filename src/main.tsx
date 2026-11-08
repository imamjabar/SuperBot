import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  readSessionState, SERVICE_TRUST_REASON, takePairingCodeFromLocation, takeInvitedEmailFromLocation,
} from "./lib/session";
import { bootstrapBrand, productName } from "./lib/brand";
import { loadPageLanguage } from "./lib/language-preference";
import { applySkinChoice, readSkinChoice } from "./lib/skins";
import { applyChatWidth, readChatWidth } from "./lib/chat-width";
import { applyFont, readFont } from "./lib/fonts";
import { settleAdvancedModeDefault } from "./lib/interface-mode";
import { PairPage } from "./pair/PairPage";
import { PageBoundary } from "./components/PageBoundary";
import { endedBeforeReload, forgetEndedSession, SESSION_ENDED_REASON } from "./lib/session-ended";
import { finishedNotificationsEnabled } from "./lib/notification-preferences";
import { enablePush, registerServiceWorker } from "./lib/web-push";
import "./styles.css";

// Before first paint; settleAdvancedModeDefault must run before applySkin writes omb-skin.
settleAdvancedModeDefault();
applySkinChoice(readSkinChoice());
applyFont(readFont());
applyChatWidth(readChatWidth());

void registerServiceWorker().then((reg) => {
  if (reg && typeof Notification !== "undefined" && Notification.permission === "granted" && finishedNotificationsEnabled()) {
    void enablePush(reg);
  }
});

// The app is its own chunk, so these pages don't parse it. Everywhere else its fetch starts now, alongside the session
// read, instead of after it. A failed fetch renders as a throw, so PageBoundary offers a reload.
const PAGES_WITHOUT_THE_APP = new Set(["/pair", "/desktop-viewer"]);
const loadApp = () => import("./App").catch((error: unknown) => ({ default: (): never => { throw error; } }));
const appPage = PAGES_WITHOUT_THE_APP.has(location.pathname) ? null : loadApp();

async function chooseRoot(): Promise<React.ReactNode> {
  if (location.pathname === "/pair") {
    return <PairPage initialCode={takePairingCodeFromLocation()} initialEmail={takeInvitedEmailFromLocation()} />;
  }
  const session = await readSessionState();
  if (session.kind === "unauthenticated") {
    return <PairPage initialCode={null} reason={endedBeforeReload() ? SESSION_ENDED_REASON : session.error} />;
  }
  forgetEndedSession();
  if (session.kind === "loopback" && session.trust === "service") return <PairPage initialCode={null} reason={SERVICE_TRUST_REASON} />;
  if (location.pathname === "/desktop-viewer") {
    const { DesktopViewer } = await import("./components/DesktopViewer");
    return <DesktopViewer />;
  }
  const { default: App } = await (appPage ?? loadApp());
  return <App />;
}

// The window is named before the brand file is asked for: the answer only ever renames it.
document.title = productName();
void Promise.all([bootstrapBrand(), chooseRoot(), loadPageLanguage()]).then(([, root]) => {
  createRoot(document.getElementById("root")!).render(<StrictMode><PageBoundary>{root}</PageBoundary></StrictMode>);
});

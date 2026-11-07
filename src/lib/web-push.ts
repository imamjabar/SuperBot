import { api } from "../state/api";
import { setActiveServiceWorkerRegistration } from "./notify";

let cachedRegistration: ServiceWorkerRegistration | null = null;

export function setCachedServiceWorkerRegistration(reg: ServiceWorkerRegistration | null): void {
  cachedRegistration = reg;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function keysEqual(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const aBytes = new Uint8Array(a);
  if (aBytes.length !== b.length) return false;
  for (let i = 0; i < aBytes.length; i++) {
    if (aBytes[i] !== b[i]) return false;
  }
  return true;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext || window.ogb) {
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    cachedRegistration = registration;
    setActiveServiceWorkerRegistration(registration);
    return registration;
  } catch {
    return null;
  }
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (cachedRegistration) return cachedRegistration;
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext || window.ogb) {
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    if (registration) {
      cachedRegistration = registration;
      setActiveServiceWorkerRegistration(registration);
    }
    return registration ?? null;
  } catch {
    return null;
  }
}

export async function enablePush(registration?: ServiceWorkerRegistration | null): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return;
  }
  try {
    const reg = registration ?? await getServiceWorkerRegistration();
    if (!reg?.pushManager) return;

    let keyResponse: { publicKey: string | null };
    try {
      keyResponse = await api<{ publicKey: string | null }>("/api/push/key");
    } catch {
      return;
    }
    const { publicKey } = keyResponse ?? {};
    if (!publicKey) return;

    const applicationServerKey = urlBase64ToUint8Array(publicKey);

    let subscription = await reg.pushManager.getSubscription();
    if (subscription) {
      if (!keysEqual(subscription.options?.applicationServerKey, applicationServerKey)) {
        await subscription.unsubscribe().catch(() => {});
        subscription = null;
      }
    }

    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as unknown as BufferSource,
      });
    }

    await api("/api/push/subscriptions", {
      method: "POST",
      body: JSON.stringify(subscription.toJSON()),
    });
  } catch {
    // Failures (PushManager missing, server 400, etc.) are silent no-ops.
  }
}

export async function disablePush(): Promise<void> {
  try {
    const reg = await getServiceWorkerRegistration();
    if (!reg?.pushManager) return;
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => {});
    if (endpoint) {
      await api("/api/push/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});
    }
  } catch {
    // Failures are silent no-ops.
  }
}

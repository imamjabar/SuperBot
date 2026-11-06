import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disablePush,
  enablePush,
  keysEqual,
  registerServiceWorker,
  setCachedServiceWorkerRegistration,
  urlBase64ToUint8Array,
} from "./web-push";

const mockApi = vi.fn();
vi.mock("../state/api", () => ({
  api: (...args: unknown[]) => mockApi(...args),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  mockApi.mockReset();
  setCachedServiceWorkerRegistration(null);
});

describe("urlBase64ToUint8Array", () => {
  it("converts base64url string with - and _ without padding", () => {
    const input = "AQ-_";
    const result = urlBase64ToUint8Array(input);
    expect(result).toEqual(new Uint8Array([1, 15, 191]));
  });

  it("handles different base64 padding requirements", () => {
    // Length 2 needs 2 padding chars
    expect(urlBase64ToUint8Array("AA")).toEqual(new Uint8Array([0]));
    // Length 3 needs 1 padding char
    expect(urlBase64ToUint8Array("AAA")).toEqual(new Uint8Array([0, 0]));
    // Length 4 needs 0 padding chars
    expect(urlBase64ToUint8Array("AAAA")).toEqual(new Uint8Array([0, 0, 0]));
  });
});

describe("keysEqual", () => {
  it("returns true for matching buffers", () => {
    const arr = new Uint8Array([1, 2, 3]);
    expect(keysEqual(arr.buffer, new Uint8Array([1, 2, 3]))).toBe(true);
  });

  it("returns false for mismatched content or length", () => {
    const arr = new Uint8Array([1, 2, 3]);
    expect(keysEqual(arr.buffer, new Uint8Array([1, 2, 4]))).toBe(false);
    expect(keysEqual(arr.buffer, new Uint8Array([1, 2]))).toBe(false);
    expect(keysEqual(null, new Uint8Array([1]))).toBe(false);
  });
});

describe("registerServiceWorker", () => {
  it("skips registration when inside Electron desktop (window.ogb present)", async () => {
    const register = vi.fn();
    vi.stubGlobal("window", { ogb: {}, isSecureContext: true });
    vi.stubGlobal("navigator", { serviceWorker: { register } });

    const result = await registerServiceWorker();
    expect(result).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("skips registration when context is not secure", async () => {
    const register = vi.fn();
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("navigator", { serviceWorker: { register } });

    const result = await registerServiceWorker();
    expect(result).toBeNull();
    expect(register).not.toHaveBeenCalled();
  });

  it("registers /sw.js with scope / in secure browser context", async () => {
    const fakeReg = { scope: "/" } as ServiceWorkerRegistration;
    const register = vi.fn(async () => fakeReg);
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", { serviceWorker: { register } });

    const result = await registerServiceWorker();
    expect(result).toBe(fakeReg);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });
});

describe("enablePush", () => {
  const sampleKey = "AQAB"; // [1, 0, 1]
  const sampleBytes = new Uint8Array([1, 0, 1]);

  beforeEach(() => {
    vi.stubGlobal("Notification", { permission: "granted" });
  });

  it("no-ops if permission is not granted", async () => {
    vi.stubGlobal("Notification", { permission: "default" });
    await enablePush();
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("no-ops silently if /api/push/key fails or returns null", async () => {
    mockApi.mockRejectedValueOnce(new Error("404 Not Found"));
    const fakeReg = {
      pushManager: {
        getSubscription: vi.fn(),
      },
    } as unknown as ServiceWorkerRegistration;

    await expect(enablePush(fakeReg)).resolves.toBeUndefined();
    expect(fakeReg.pushManager.getSubscription).not.toHaveBeenCalled();
  });

  it("subscribes and posts subscription to /api/push/subscriptions when none exists", async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/api/push/key") return { publicKey: sampleKey };
      if (path === "/api/push/subscriptions") return { ok: true };
      throw new Error(`Unexpected path: ${path}`);
    });

    const fakeSubscription = {
      endpoint: "https://push.example.com/sub/1",
      toJSON: () => ({ endpoint: "https://push.example.com/sub/1", keys: { p256dh: "key", auth: "auth" } }),
    };

    const subscribe = vi.fn(async () => fakeSubscription);
    const fakeReg = {
      pushManager: {
        getSubscription: vi.fn(async () => null),
        subscribe,
      },
    } as unknown as ServiceWorkerRegistration;

    await enablePush(fakeReg);

    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: sampleBytes,
    });
    expect(mockApi).toHaveBeenCalledWith("/api/push/subscriptions", {
      method: "POST",
      body: JSON.stringify(fakeSubscription.toJSON()),
    });
  });

  it("reuses existing subscription when applicationServerKey matches", async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/api/push/key") return { publicKey: sampleKey };
      if (path === "/api/push/subscriptions") return { ok: true };
      throw new Error(`Unexpected path: ${path}`);
    });

    const fakeSubscription = {
      endpoint: "https://push.example.com/sub/1",
      options: { applicationServerKey: sampleBytes.buffer },
      unsubscribe: vi.fn(),
      toJSON: () => ({ endpoint: "https://push.example.com/sub/1", keys: { p256dh: "k", auth: "a" } }),
    };

    const subscribe = vi.fn();
    const fakeReg = {
      pushManager: {
        getSubscription: vi.fn(async () => fakeSubscription),
        subscribe,
      },
    } as unknown as ServiceWorkerRegistration;

    await enablePush(fakeReg);

    expect(fakeSubscription.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(mockApi).toHaveBeenCalledWith("/api/push/subscriptions", {
      method: "POST",
      body: JSON.stringify(fakeSubscription.toJSON()),
    });
  });

  it("unsubscribes and resubscribes when applicationServerKey differs", async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/api/push/key") return { publicKey: sampleKey };
      if (path === "/api/push/subscriptions") return { ok: true };
      throw new Error(`Unexpected path: ${path}`);
    });

    const oldSubscription = {
      endpoint: "https://push.example.com/old",
      options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer },
      unsubscribe: vi.fn(async () => true),
    };

    const newSubscription = {
      endpoint: "https://push.example.com/new",
      toJSON: () => ({ endpoint: "https://push.example.com/new", keys: { p256dh: "k2", auth: "a2" } }),
    };

    const subscribe = vi.fn(async () => newSubscription);
    const fakeReg = {
      pushManager: {
        getSubscription: vi.fn(async () => oldSubscription),
        subscribe,
      },
    } as unknown as ServiceWorkerRegistration;

    await enablePush(fakeReg);

    expect(oldSubscription.unsubscribe).toHaveBeenCalled();
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: sampleBytes,
    });
    expect(mockApi).toHaveBeenCalledWith("/api/push/subscriptions", {
      method: "POST",
      body: JSON.stringify(newSubscription.toJSON()),
    });
  });
});

describe("disablePush", () => {
  it("unsubscribes and deletes subscription from server", async () => {
    mockApi.mockResolvedValue({ ok: true });

    const unsubscribe = vi.fn(async () => true);
    const fakeSub = {
      endpoint: "https://push.example.com/sub/active",
      unsubscribe,
    };
    const fakeReg = {
      pushManager: {
        getSubscription: vi.fn(async () => fakeSub),
      },
    } as unknown as ServiceWorkerRegistration;

    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn(async () => fakeReg),
      },
    });

    await disablePush();

    expect(unsubscribe).toHaveBeenCalled();
    expect(mockApi).toHaveBeenCalledWith("/api/push/subscriptions", {
      method: "DELETE",
      body: JSON.stringify({ endpoint: "https://push.example.com/sub/active" }),
    });
  });
});

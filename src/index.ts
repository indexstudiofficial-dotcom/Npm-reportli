// src/index.ts — Reportli SDK v1.0.8
// Sends errors immediately or in queue, but stores user activity in-session and sends it once on exit.

const WORKER_URL = "https://old-paper-f025.reportliaihq.workers.dev";

type Config = {
  apiKey: string;
  environment?: string;
};

type UserIdentity = {
  email?: string;
  name?: string;
  userId?: string;
};

type ErrorPayload = {
  type: string;
  message: string;
  code: string;
  stack: string;
  file: string;
  line: number;
  column: number;
  url: string;
  timestamp: string;
  environment: string;
  browser: string;
  error_category: string;
  severity: "low" | "medium" | "high" | "critical";
  status: string;
  context: string;
  user_email?: string;
  user_name?: string;
  user_id?: string;
  session_id?: string;
};

type ActivityEvent = {
  event: string;
  timestamp: string;
  url: string;
  properties?: Record<string, unknown>;
};

type SessionEndPayload = {
  type: "SESSION_END";
  session_id: string;
  user_email: string;
  user_name?: string;
  user_id?: string;
  started_at: string;
  ended_at: string;
  duration_seconds: number;
  page_views: number;
  environment: string;
  browser: string;
  events: ActivityEvent[];
};

let initialized = false;
let _config: Config;
let _user: UserIdentity = {};
let _sessionId = "";
let _sessionStartedAt = "";
let _pageViews = 0;
let _sessionEvents: ActivityEvent[] = [];
let _hasFlushedSession = false;

const queue: ErrorPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;

const _isBrowser = (() => {
  try { return typeof window !== "undefined" && typeof document !== "undefined"; }
  catch { return false; }
})();

const _isNode = (() => {
  try { return typeof process !== "undefined" && !!process.versions?.node && !_isBrowser; }
  catch { return false; }
})();

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function startSession(): void {
  _sessionId = generateId();
  _sessionStartedAt = new Date().toISOString();
  _pageViews = 0;
  _sessionEvents = [];
  _hasFlushedSession = false;
}

function getUserEmail(): string {
  return _user.email || "anonymous";
}

async function sendToWorker(payload: object, attempts = 3): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": _config?.apiKey ?? "",
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      if (res.ok) return;
    } catch {}
    await sleep(1000 * (i + 1));
  }
}

function sendImmediate(payload: object): void {
  sendToWorker(payload).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueueError(payload: ErrorPayload): void {
  if (!initialized) return;
  if (queue.length >= 100) return;
  queue.push(payload);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushErrors();
  }, 2000);
}

async function flushErrors(): Promise<void> {
  if (isFlushing || queue.length === 0) return;
  isFlushing = true;
  const batch = queue.splice(0, 10);
  for (const payload of batch) {
    await sendToWorker(payload);
  }
  isFlushing = false;
  if (queue.length > 0) flushErrors();
}

function getUrl(): string {
  try {
    if (_isBrowser) return window.location.href;
    if (_isNode) return require("os").hostname();
  } catch {}
  return "unknown";
}

function getBrowser(): string {
  try {
    if (_isBrowser && navigator?.userAgent) return navigator.userAgent;
    if (_isNode) return `Node.js ${process.version}`;
  } catch {}
  return "unknown";
}

function getEnvironment(): string {
  return _config?.environment ?? (_isBrowser ? "browser" : "server");
}

function parseStack(stack: string | undefined): { file: string; line: number; column: number } {
  try {
    if (!stack) return { file: "unknown", line: 0, column: 0 };
    const match = stack.match(/at .+ ((.+):(d+):(d+))/) || stack.match(/at (.+):(d+):(d+)/);
    return {
      file: match?.[1]?.split("/")?.pop() || "unknown",
      line: parseInt(match?.[2] || "0"),
      column: parseInt(match?.[3] || "0"),
    };
  } catch {
    return { file: "unknown", line: 0, column: 0 };
  }
}

function getErrorCode(error: any): string {
  try {
    return error?.code || error?.status?.toString() || error?.name || "ERR_UNKNOWN";
  } catch {
    return "ERR_UNKNOWN";
  }
}

function classifyError(error: any, context?: string): { category: string; severity: "low" | "medium" | "high" | "critical" } {
  try {
    const msg = String(error?.message || error || "").toLowerCase();
    const name = String(error?.name || "").toLowerCase();

    if (msg.includes("stripe") || msg.includes("payment") || msg.includes("card declined") || msg.includes("checkout") || msg.includes("refund")) return { category: "Payment Error", severity: "critical" };
    if (msg.includes("jwt") || msg.includes("token expired") || msg.includes("unauthorized") || msg.includes("session") || msg.includes("oauth") || msg.includes("login failed")) return { category: "Auth Error", severity: "high" };
    if (msg.includes("supabase") || msg.includes("database") || msg.includes("connection lost") || msg.includes("transaction") || msg.includes("duplicate key")) return { category: "Database Error", severity: "critical" };
    if (msg.includes("hydration") || msg.includes("does not match server")) return { category: "Hydration Error", severity: "high" };
    if (msg.includes("invalid hook") || msg.includes("rules of hooks")) return { category: "Hook Error", severity: "critical" };
    if (msg.includes("render") || msg.includes("error boundary")) return { category: "Render Error", severity: "critical" };
    if (msg.includes("dynamic import") || msg.includes("failed to fetch dynamically")) return { category: "Import Error", severity: "high" };
    if (msg.includes("cors") || msg.includes("cross-origin")) return { category: "CORS Error", severity: "high" };
    if (msg.includes("fetch failed") || msg.includes("failed to fetch") || name === "fetcherror") return { category: "Network Error", severity: "high" };
    if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout")) return { category: "Timeout Error", severity: "medium" };
    if (msg.includes("websocket")) return { category: "WebSocket Error", severity: "high" };
    if (msg.includes("http 401") || msg.includes("xhr 401")) return { category: "Auth Error", severity: "high" };
    if (msg.includes("http 403") || msg.includes("xhr 403")) return { category: "Auth Error", severity: "high" };
    if (msg.includes("http 404") || msg.includes("xhr 404")) return { category: "Not Found Error", severity: "medium" };
    if (msg.includes("http 500") || msg.includes("xhr 500")) return { category: "Server Error", severity: "critical" };
    if (msg.includes("http 503") || msg.includes("xhr 503")) return { category: "Server Error", severity: "critical" };
    if (msg.includes("maximum call stack") || msg.includes("out of memory") || msg.includes("heap limit")) return { category: "Memory Error", severity: "critical" };
    if (msg.includes("cannot find module") || msg.includes("module not found")) return { category: "Module Error", severity: "critical" };
    if (msg.includes("econnrefused") || msg.includes("connection refused")) return { category: "Connection Error", severity: "critical" };
    if (msg.includes("email") || msg.includes("smtp") || msg.includes("sendgrid")) return { category: "Email Error", severity: "high" };
    if (msg.includes("cron") || msg.includes("webhook") || msg.includes("queue")) return { category: "Job Error", severity: "high" };
    if (msg.includes("upload") || msg.includes("file size") || msg.includes("invalid file")) return { category: "File Error", severity: "medium" };
    if (msg.includes("quota exceeded") || msg.includes("localstorage") || msg.includes("indexeddb")) return { category: "Storage Error", severity: "medium" };
    if (name === "typeerror") return { category: "TypeError", severity: "high" };
    if (name === "referenceerror") return { category: "ReferenceError", severity: "critical" };
    if (name === "rangeerror") return { category: "RangeError", severity: "high" };
    if (name === "syntaxerror") return { category: "SyntaxError", severity: "high" };
    if (context === "unhandledrejection") return { category: "Promise Error", severity: "medium" };
    if (context === "express") return { category: "Server Error", severity: "high" };
    if (context === "resource") return { category: "Resource Error", severity: "low" };
  } catch {}
  return { category: "Unknown Error", severity: "medium" };
}

function buildPayload(error: any, context?: string): ErrorPayload {
  try {
    const message = String(error?.message || error || "Unknown error").slice(0, 1000);
    const stack = String(error?.stack || "").slice(0, 3000);
    const { file, line, column } = parseStack(stack);
    const { category, severity } = classifyError(error, context);

    return {
      type: "ERROR",
      message,
      code: getErrorCode(error),
      stack,
      file,
      line,
      column,
      url: getUrl(),
      timestamp: new Date().toISOString(),
      environment: getEnvironment(),
      browser: getBrowser(),
      error_category: category,
      severity,
      status: "open",
      context: context || "auto",
      user_email: getUserEmail(),
      user_name: _user.name || undefined,
      user_id: _user.userId || undefined,
      session_id: _sessionId,
    };
  } catch {
    return {
      type: "ERROR",
      message: "Unknown error",
      code: "ERR_UNKNOWN",
      stack: "",
      file: "unknown",
      line: 0,
      column: 0,
      url: getUrl(),
      timestamp: new Date().toISOString(),
      environment: getEnvironment(),
      browser: getBrowser(),
      error_category: "Unknown Error",
      severity: "medium",
      status: "open",
      context: "auto",
      user_email: getUserEmail(),
      session_id: _sessionId,
    };
  }
}

function buildActivityEvent(event: string, properties?: Record<string, unknown>): ActivityEvent {
  return {
    event,
    timestamp: new Date().toISOString(),
    url: getUrl(),
    properties: properties || {},
  };
}

function recordActivity(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return;
  if (!event) return;
  _sessionEvents.push(buildActivityEvent(event, properties));
}

function sendSessionEnd(): void {
  try {
    if (!_sessionId || _hasFlushedSession) return;
    _hasFlushedSession = true;

    const endedAt = new Date().toISOString();
    const startMs = new Date(_sessionStartedAt).getTime();
    const endMs = new Date(endedAt).getTime();
    const durationSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));

    const sessionPayload: SessionEndPayload = {
      type: "SESSION_END",
      session_id: _sessionId,
      user_email: getUserEmail(),
      user_name: _user.name || undefined,
      user_id: _user.userId || undefined,
      started_at: _sessionStartedAt,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      page_views: _pageViews,
      environment: getEnvironment(),
      browser: getBrowser(),
      events: _sessionEvents,
    };

    if (_isBrowser && navigator.sendBeacon) {
      navigator.sendBeacon(WORKER_URL, JSON.stringify(sessionPayload));
    } else {
      sendImmediate(sessionPayload);
    }
  } catch {}
}

function patchFetch(): void {
  try {
    const originalFetch = window.fetch.bind(window);
    (window as any).__originalFetch = originalFetch;

    const patchedFetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
      const url = (() => {
        try {
          return typeof args[0] === "string" ? args[0] : args[0] instanceof URL ? args[0].toString() : (args[0] as Request)?.url ?? "";
        } catch { return ""; }
      })();

      if (url.includes("old-paper-f025.reportliaihq.workers.dev")) {
        return originalFetch(...args);
      }

      try {
        const response = await originalFetch(...args);
        if (!response.ok) {
          enqueueError(buildPayload({
            name: `HTTP_${response.status}`,
            message: `HTTP ${response.status}: ${(args[1] as RequestInit)?.method || "GET"} ${url}`,
            stack: `${(args[1] as RequestInit)?.method || "GET"} ${url} → ${response.status} ${response.statusText}`,
            status: response.status,
          }, "fetch"));
        }
        return response;
      } catch (err: any) {
        enqueueError(buildPayload({
          name: "FetchError",
          message: `Fetch failed: ${url} — ${err?.message}`,
          stack: err?.stack,
        }, "fetch"));
        throw err;
      }
    };

    try {
      window.fetch = patchedFetch;
    } catch {
      Object.defineProperty(window, "fetch", {
        value: patchedFetch,
        writable: true,
        configurable: true,
      });
    }
  } catch {}
}

function trackPageViews(): void {
  try {
    _pageViews++;
    recordActivity("page_view", { path: window.location.pathname });

    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(history, args);
      _pageViews++;
      recordActivity("page_view", { path: window.location.pathname });
    };

    window.addEventListener("popstate", () => {
      _pageViews++;
      recordActivity("page_view", { path: window.location.pathname });
    });
  } catch {}
}

function activateBrowserListeners(): void {
  try {
    window.addEventListener("error", (event) => {
      try {
        const target = event.target as HTMLElement;
        if (target?.tagName && ["IMG", "SCRIPT", "LINK", "VIDEO", "AUDIO"].includes(target.tagName)) {
          const src = (target as any).src || (target as any).href || "unknown";
          enqueueError(buildPayload({ name: "ResourceError", message: `${target.tagName} failed to load: ${src}`, stack: "" }, "resource"));
          return;
        }
        const err = (event as ErrorEvent).error || {
          name: "Error",
          message: (event as ErrorEvent).message || "Unknown error",
          stack: `at ${(event as ErrorEvent).filename}:${(event as ErrorEvent).lineno}:${(event as ErrorEvent).colno}`,
        };
        enqueueError(buildPayload(err, "window"));
      } catch {}
    }, true);
  } catch {}

  try {
    window.addEventListener("unhandledrejection", (event) => {
      try {
        const err = event.reason instanceof Error
          ? event.reason
          : { name: "UnhandledRejection", message: String(event.reason || "Unhandled Promise Rejection"), stack: "" };
        enqueueError(buildPayload(err, "unhandledrejection"));
      } catch {}
    });
  } catch {}

  patchFetch();

  try {
    const OrigOpen = XMLHttpRequest.prototype.open;
    const OrigSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: any[]) {
      try {
        (this as any)._r_method = method;
        (this as any)._r_url = url;
      } catch {}
      return OrigOpen.call(this, method, url, ...rest);
    } as any;

    XMLHttpRequest.prototype.send = function (...args: any[]) {
      try {
        const url: string = (this as any)._r_url || "";
        const method: string = (this as any)._r_method || "GET";
        if (!url.includes("old-paper-f025.reportliaihq.workers.dev")) {
          this.addEventListener("loadend", () => {
            try {
              if (this.status >= 400 || this.status === 0) {
                enqueueError(buildPayload({
                  name: `XHR_${this.status}`,
                  message: `XHR ${this.status}: ${method} ${url}`,
                  stack: `${method} ${url} → ${this.status} ${this.statusText}`,
                  status: this.status,
                }, "xhr"));
              }
            } catch {}
          });
        }
      } catch {}
      return OrigSend.apply(this, args);
    } as any;
  } catch {}

  trackPageViews();

  try {
    window.addEventListener("beforeunload", () => {
      try { sendSessionEnd(); } catch {}
    });
  } catch {}

  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        recordActivity("tab_hidden");
      } else {
        recordActivity("tab_visible");
      }
    });
  } catch {}
}

function activateServerListeners(): void {
  try {
    process.on("uncaughtException", (error: Error) => {
      try { enqueueError(buildPayload(error, "uncaughtException")); flushErrors(); } catch {}
    });
  } catch {}

  try {
    process.on("unhandledRejection", (reason: any) => {
      try {
        enqueueError(buildPayload(
          reason instanceof Error ? reason : { name: "UnhandledRejection", message: String(reason), stack: "" },
          "unhandledrejection"
        ));
      } catch {}
    });
  } catch {}

  const shutdown = async (signal: string) => {
    try {
      sendSessionEnd();
      await sendToWorker({
        type: "SDK_DISCONNECTED",
        timestamp: new Date().toISOString(),
        environment: getEnvironment(),
        url: getUrl(),
        signal,
      });
    } catch {}
    process.exit(0);
  };

  try { process.on("SIGTERM", () => shutdown("SIGTERM")); } catch {}
  try { process.on("SIGINT", () => shutdown("SIGINT")); } catch {}
}

export const Reportli = {
  init(cfg: Config): void {
    try {
      if (initialized) return;
      if (!cfg?.apiKey) return;

      _config = cfg;
      initialized = true;
      startSession();

      sendImmediate({
        type: "SDK_INITIALIZED",
        timestamp: new Date().toISOString(),
        environment: getEnvironment(),
        url: getUrl(),
        browser: getBrowser(),
        session_id: _sessionId,
      });

      if (_isBrowser) activateBrowserListeners();
      else if (_isNode) activateServerListeners();
    } catch {}
  },

  identify(user: UserIdentity): void {
    try {
      if (!initialized) return;
      _user = {
        email: user.email || undefined,
        name: user.name || undefined,
        userId: user.userId || undefined,
      };

      sendImmediate({
        type: "IDENTIFY",
        user_email: getUserEmail(),
        user_name: _user.name || undefined,
        user_id: _user.userId || undefined,
        session_id: _sessionId,
        timestamp: new Date().toISOString(),
        environment: getEnvironment(),
      });
    } catch {}
  },

  track(event: string, properties?: Record<string, unknown>): void {
    try {
      if (!initialized) return;
      if (!event) return;
      recordActivity(event, properties);
    } catch {}
  },

  capture(error: unknown): void {
    try {
      if (!initialized) return;
      const err = error instanceof Error
        ? error
        : { name: "ManualCapture", message: String(error), stack: new Error().stack };
      enqueueError(buildPayload(err, "manual"));
    } catch {}
  },

  captureMessage(message: string): void {
    try {
      if (!initialized) return;
      enqueueError(buildPayload({ name: "Message", message, stack: "" }, "manual"));
    } catch {}
  },

  errorHandler() {
    return function (err: any, _req: any, _res: any, next: any) {
      try { enqueueError(buildPayload(err, "express")); } catch {}
      next(err);
    };
  },

  flushSession(): void {
    sendSessionEnd();
  },
};

export default Reportli;

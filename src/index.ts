// src/index.ts — Reportli SDK v1.0.6
// Sends all errors to Cloudflare Worker

// ─── Config ───────────────────────────────────────────────────────────────────

const WORKER_URL = "https://old-paper-f025.reportliaihq.workers.dev";

// ─── Types ────────────────────────────────────────────────────────────────────

type Config = {
  apiKey: string;
  environment?: string;
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
};

// ─── State ────────────────────────────────────────────────────────────────────

let initialized = false;
let _config: Config;
const queue: ErrorPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;

// ─── Environment ──────────────────────────────────────────────────────────────

const _isBrowser = (() => {
  try { return typeof window !== "undefined" && typeof document !== "undefined"; }
  catch { return false; }
})();

const _isNode = (() => {
  try { return typeof process !== "undefined" && !!process.versions?.node && !_isBrowser; }
  catch { return false; }
})();

// ─── Send to Worker ───────────────────────────────────────────────────────────

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
    } catch {
      // wait before retry
    }
    await sleep(1000 * (i + 1));
  }
}

function sendImmediate(payload: object): void {
  sendToWorker(payload).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Queue & Batch ────────────────────────────────────────────────────────────

function enqueue(payload: ErrorPayload): void {
  if (!initialized) return;
  if (queue.length >= 100) return;
  queue.push(payload);
  scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 2000);
}

async function flush(): Promise<void> {
  if (isFlushing || queue.length === 0) return;
  isFlushing = true;
  const batch = queue.splice(0, 10);
  for (const payload of batch) {
    await sendToWorker(payload);
  }
  isFlushing = false;
  if (queue.length > 0) flush();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUrl(): string {
  try {
    if (_isBrowser) return window.location.href;
    if (_isNode) return require("os").hostname();
  } catch { /* silent */ }
  return "unknown";
}

function getBrowser(): string {
  try {
    if (_isBrowser && navigator?.userAgent) return navigator.userAgent;
    if (_isNode) return `Node.js ${process.version}`;
  } catch { /* silent */ }
  return "unknown";
}

function getEnvironment(): string {
  return _config?.environment ?? (_isBrowser ? "browser" : "server");
}

function parseStack(stack: string | undefined): { file: string; line: number; column: number } {
  try {
    if (!stack) return { file: "unknown", line: 0, column: 0 };
    const match =
      stack.match(/at .+ \((.+):(\d+):(\d+)\)/) ||
      stack.match(/at (.+):(\d+):(\d+)/);
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

    if (msg.includes("stripe") || msg.includes("payment") || msg.includes("card declined") || msg.includes("checkout") || msg.includes("refund"))
      return { category: "Payment Error", severity: "critical" };
    if (msg.includes("jwt") || msg.includes("token expired") || msg.includes("unauthorized") || msg.includes("session") || msg.includes("oauth") || msg.includes("login failed"))
      return { category: "Auth Error", severity: "high" };
    if (msg.includes("supabase") || msg.includes("database") || msg.includes("connection lost") || msg.includes("transaction") || msg.includes("duplicate key"))
      return { category: "Database Error", severity: "critical" };
    if (msg.includes("hydration") || msg.includes("does not match server"))
      return { category: "Hydration Error", severity: "high" };
    if (msg.includes("invalid hook") || msg.includes("rules of hooks"))
      return { category: "Hook Error", severity: "critical" };
    if (msg.includes("render") || msg.includes("error boundary"))
      return { category: "Render Error", severity: "critical" };
    if (msg.includes("dynamic import") || msg.includes("failed to fetch dynamically"))
      return { category: "Import Error", severity: "high" };
    if (msg.includes("cors") || msg.includes("cross-origin"))
      return { category: "CORS Error", severity: "high" };
    if (msg.includes("fetch failed") || msg.includes("failed to fetch") || name === "fetcherror")
      return { category: "Network Error", severity: "high" };
    if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout"))
      return { category: "Timeout Error", severity: "medium" };
    if (msg.includes("websocket"))
      return { category: "WebSocket Error", severity: "high" };
    if (msg.includes("http 401") || msg.includes("xhr 401"))
      return { category: "Auth Error", severity: "high" };
    if (msg.includes("http 403") || msg.includes("xhr 403"))
      return { category: "Auth Error", severity: "high" };
    if (msg.includes("http 404") || msg.includes("xhr 404"))
      return { category: "Not Found Error", severity: "medium" };
    if (msg.includes("http 500") || msg.includes("xhr 500"))
      return { category: "Server Error", severity: "critical" };
    if (msg.includes("http 503") || msg.includes("xhr 503"))
      return { category: "Server Error", severity: "critical" };
    if (msg.includes("maximum call stack") || msg.includes("out of memory") || msg.includes("heap limit"))
      return { category: "Memory Error", severity: "critical" };
    if (msg.includes("cannot find module") || msg.includes("module not found"))
      return { category: "Module Error", severity: "critical" };
    if (msg.includes("econnrefused") || msg.includes("connection refused"))
      return { category: "Connection Error", severity: "critical" };
    if (msg.includes("email") || msg.includes("smtp") || msg.includes("sendgrid"))
      return { category: "Email Error", severity: "high" };
    if (msg.includes("cron") || msg.includes("webhook") || msg.includes("queue"))
      return { category: "Job Error", severity: "high" };
    if (msg.includes("upload") || msg.includes("file size") || msg.includes("invalid file"))
      return { category: "File Error", severity: "medium" };
    if (msg.includes("quota exceeded") || msg.includes("localstorage") || msg.includes("indexeddb"))
      return { category: "Storage Error", severity: "medium" };
    if (name === "typeerror") return { category: "TypeError", severity: "high" };
    if (name === "referenceerror") return { category: "ReferenceError", severity: "critical" };
    if (name === "rangeerror") return { category: "RangeError", severity: "high" };
    if (name === "syntaxerror") return { category: "SyntaxError", severity: "high" };
    if (context === "unhandledrejection") return { category: "Promise Error", severity: "medium" };
    if (context === "express") return { category: "Server Error", severity: "high" };
    if (context === "resource") return { category: "Resource Error", severity: "low" };
  } catch { /* silent */ }

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
    };
  }
}

// ─── Patch fetch safely ───────────────────────────────────────────────────────

function patchFetch(): void {
  try {
    const originalFetch = window.fetch.bind(window);
    (window as any).__originalFetch = originalFetch;

    const patchedFetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
      const url = (() => {
        try {
          return typeof args[0] === "string"
            ? args[0]
            : args[0] instanceof URL
            ? args[0].toString()
            : (args[0] as Request)?.url ?? "";
        } catch { return ""; }
      })();

      // Never intercept Worker requests
      if (url.includes("old-paper-f025.reportliaihq.workers.dev")) {
        return originalFetch(...args);
      }

      try {
        const response = await originalFetch(...args);
        if (!response.ok) {
          enqueue(buildPayload({
            name: `HTTP_${response.status}`,
            message: `HTTP ${response.status}: ${(args[1] as RequestInit)?.method || "GET"} ${url}`,
            stack: `${(args[1] as RequestInit)?.method || "GET"} ${url} → ${response.status} ${response.statusText}`,
            status: response.status,
          }, "fetch"));
        }
        return response;
      } catch (err: any) {
        enqueue(buildPayload({
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
  } catch { /* silent */ }
}

// ─── Browser Listeners ────────────────────────────────────────────────────────

function activateBrowserListeners(): void {
  // JS errors + resource errors
  try {
    window.addEventListener("error", (event) => {
      try {
        const target = event.target as HTMLElement;
        if (target?.tagName && ["IMG", "SCRIPT", "LINK", "VIDEO", "AUDIO"].includes(target.tagName)) {
          const src = (target as any).src || (target as any).href || "unknown";
          enqueue(buildPayload({ name: "ResourceError", message: `${target.tagName} failed to load: ${src}`, stack: "" }, "resource"));
          return;
        }
        const err = (event as ErrorEvent).error || {
          name: "Error",
          message: (event as ErrorEvent).message || "Unknown error",
          stack: `at ${(event as ErrorEvent).filename}:${(event as ErrorEvent).lineno}:${(event as ErrorEvent).colno}`,
        };
        enqueue(buildPayload(err, "window"));
      } catch { /* silent */ }
    }, true);
  } catch { /* silent */ }

  // Promise rejections
  try {
    window.addEventListener("unhandledrejection", (event) => {
      try {
        const err = event.reason instanceof Error
          ? event.reason
          : { name: "UnhandledRejection", message: String(event.reason || "Unhandled Promise Rejection"), stack: "" };
        enqueue(buildPayload(err, "unhandledrejection"));
      } catch { /* silent */ }
    });
  } catch { /* silent */ }

  // Fetch interception
  patchFetch();

  // XHR interception
  try {
    const OrigOpen = XMLHttpRequest.prototype.open;
    const OrigSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: any[]) {
      try {
        (this as any)._r_method = method;
        (this as any)._r_url = url;
      } catch { /* silent */ }
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
                enqueue(buildPayload({
                  name: `XHR_${this.status}`,
                  message: `XHR ${this.status}: ${method} ${url}`,
                  stack: `${method} ${url} → ${this.status} ${this.statusText}`,
                  status: this.status,
                }, "xhr"));
              }
            } catch { /* silent */ }
          });
        }
      } catch { /* silent */ }
      return OrigSend.apply(this, args);
    } as any;
  } catch { /* silent */ }

  // Disconnect on page close
  try {
    window.addEventListener("beforeunload", () => {
      try {
        navigator.sendBeacon(
          WORKER_URL,
          JSON.stringify({
            type: "SDK_DISCONNECTED",
            timestamp: new Date().toISOString(),
            environment: getEnvironment(),
            url: getUrl(),
          })
        );
      } catch { /* silent */ }
    });
  } catch { /* silent */ }
}

// ─── Server Listeners ─────────────────────────────────────────────────────────

function activateServerListeners(): void {
  try {
    process.on("uncaughtException", (error: Error) => {
      try { enqueue(buildPayload(error, "uncaughtException")); flush(); } catch { /* silent */ }
    });
  } catch { /* silent */ }

  try {
    process.on("unhandledRejection", (reason: any) => {
      try {
        enqueue(buildPayload(
          reason instanceof Error ? reason : { name: "UnhandledRejection", message: String(reason), stack: "" },
          "unhandledrejection"
        ));
      } catch { /* silent */ }
    });
  } catch { /* silent */ }

  const shutdown = async (signal: string) => {
    try {
      await sendToWorker({
        type: "SDK_DISCONNECTED",
        timestamp: new Date().toISOString(),
        environment: getEnvironment(),
        url: getUrl(),
        signal,
      });
    } catch { /* silent */ }
    process.exit(0);
  };

  try { process.on("SIGTERM", () => shutdown("SIGTERM")); } catch { /* silent */ }
  try { process.on("SIGINT", () => shutdown("SIGINT")); } catch { /* silent */ }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const Reportli = {
  init(cfg: Config): void {
    try {
      if (initialized) return;
      if (!cfg?.apiKey) return;

      _config = cfg;
      initialized = true;

      // Send connected ping immediately
      sendImmediate({
        type: "SDK_INITIALIZED",
        timestamp: new Date().toISOString(),
        environment: getEnvironment(),
        url: getUrl(),
        browser: getBrowser(),
      });

      if (_isBrowser) {
        activateBrowserListeners();
      } else if (_isNode) {
        activateServerListeners();
      }
    } catch { /* never crash user app */ }
  },

  capture(error: unknown): void {
    try {
      if (!initialized) return;
      const err = error instanceof Error
        ? error
        : { name: "ManualCapture", message: String(error), stack: new Error().stack };
      enqueue(buildPayload(err, "manual"));
    } catch { /* silent */ }
  },

  captureMessage(message: string): void {
    try {
      if (!initialized) return;
      enqueue(buildPayload({ name: "Message", message, stack: "" }, "manual"));
    } catch { /* silent */ }
  },

  errorHandler() {
    return function (err: any, _req: any, _res: any, next: any) {
      try { enqueue(buildPayload(err, "express")); } catch { /* silent */ }
      next(err);
    };
  },
};

export default Reportli;

// src/index.ts — Reportli SDK v1.0.5
// Bulletproof — works in Next.js 13+, React, Vue, Express, Node.js

// ─── Reportli Config ──────────────────────────────────────────────────────────

const REPORTLI_URL = "https://fahikyfmgdyzejdfftox.supabase.co/rest/v1/exact_errors";
const REPORTLI_KEY = "sb_publishable_2-asMn5JsJduO5vm-ZBiMg_nUsdWjfZ";

// ─── Types ────────────────────────────────────────────────────────────────────

type Config = {
  apiKey: string;
  environment?: string;
};

type QueueItem = Record<string, unknown>;

// ─── State ────────────────────────────────────────────────────────────────────

let initialized = false;
let _config: Config;
const queue: QueueItem[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let isFlushing = false;

// ─── Environment detection ────────────────────────────────────────────────────

// Safe checks — never throw
const _isBrowser = (() => {
  try { return typeof window !== "undefined" && typeof document !== "undefined"; }
  catch { return false; }
})();

const _isNode = (() => {
  try { return typeof process !== "undefined" && !!process.versions?.node && !_isBrowser; }
  catch { return false; }
})();

// ─── Safe fetch — uses native fetch without overriding it ─────────────────────

async function safeFetch(url: string, body: object): Promise<void> {
  try {
    // Use native fetch directly — never override window.fetch
    const fetchFn: typeof fetch = _isBrowser
      ? (window as any).__originalFetch || window.fetch  // use original if available
      : fetch;

    await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": REPORTLI_KEY,
        "Authorization": `Bearer ${REPORTLI_KEY}`,
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(body),
      // keepalive allows request to complete even if page is unloading
      keepalive: true,
    });
  } catch {
    // Fail completely silently — never crash user app
  }
}

// ─── Queue & Batch Send ───────────────────────────────────────────────────────

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 2000);
}

async function flush() {
  if (isFlushing || queue.length === 0) return;
  isFlushing = true;

  const batch = queue.splice(0, 10);
  for (const payload of batch) {
    await saveRow(payload);
  }

  isFlushing = false;
  if (queue.length > 0) flush();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveRow(payload: QueueItem, attempts = 3): Promise<void> {
  const row = {
    api_key: _config?.apiKey ?? "",
    error_message: buildErrorMessage(payload),
    payload: payload,
    processed: false,
  };

  for (let i = 0; i < attempts; i++) {
    try {
      await safeFetch(REPORTLI_URL, row);
      return; // success
    } catch {
      // wait before retry
    }
    await sleep(1000 * (i + 1));
  }
}

function saveImmediate(payload: QueueItem) {
  const row = {
    api_key: _config?.apiKey ?? "",
    error_message: buildErrorMessage(payload),
    payload: payload,
    processed: true,
  };
  safeFetch(REPORTLI_URL, row).catch(() => {});
}

function enqueue(payload: QueueItem) {
  if (!initialized) return;
  if (queue.length >= 100) return;
  queue.push(payload);
  scheduleFlush();
}

// ─── Build human readable error message ──────────────────────────────────────

function buildErrorMessage(payload: QueueItem): string {
  const parts: string[] = [];
  if (payload.error_category) parts.push(`[${String(payload.error_category)}]`);
  if (payload.message) parts.push(String(payload.message).slice(0, 500));
  if (payload.file && payload.file !== "unknown") parts.push(`in ${payload.file}`);
  if (payload.line && payload.line !== 0) parts.push(`at line ${payload.line}`);
  if (payload.severity) parts.push(`— severity: ${payload.severity}`);
  if (payload.url) parts.push(`— url: ${String(payload.url).slice(0, 200)}`);
  return parts.join(" ") || "Unknown error";
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
    return error?.code || error?.status?.toString() || error?.statusCode?.toString() || error?.name || "ERR_UNKNOWN";
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
    if (msg.includes("supabase") || msg.includes("database") || msg.includes("connection lost") || msg.includes("transaction") || msg.includes("duplicate key") || msg.includes("foreign key"))
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

function buildErrorPayload(error: any, context?: string): QueueItem {
  try {
    const message = String(error?.message || error || "Unknown error").slice(0, 1000);
    const stack = String(error?.stack || "");
    const { file, line, column } = parseStack(stack);
    const { category, severity } = classifyError(error, context);

    return {
      type: "ERROR",
      message,
      code: getErrorCode(error),
      stack: stack.slice(0, 3000),
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
      message: "Error capturing failed",
      error_category: "Unknown Error",
      severity: "low",
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Patch fetch safely ───────────────────────────────────────────────────────
// Uses Object.defineProperty to safely override even read-only fetch in Next.js

function patchFetch() {
  try {
    const originalFetch = window.fetch.bind(window);

    // Store original so our safeFetch can use it
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

      // Never intercept Reportli requests
      if (url.includes("fahikyfmgdyzejdfftox.supabase.co")) {
        return originalFetch(...args);
      }

      try {
        const response = await originalFetch(...args);
        if (!response.ok) {
          enqueue(buildErrorPayload({
            name: `HTTP_${response.status}`,
            message: `HTTP ${response.status}: ${(args[1] as RequestInit)?.method || "GET"} ${url}`,
            stack: `${(args[1] as RequestInit)?.method || "GET"} ${url} → ${response.status} ${response.statusText}`,
            status: response.status,
          }, "fetch"));
        }
        return response;
      } catch (err: any) {
        enqueue(buildErrorPayload({
          name: "FetchError",
          message: `Fetch failed: ${url} — ${err?.message}`,
          stack: err?.stack,
        }, "fetch"));
        throw err;
      }
    };

    // Try standard assignment first
    try {
      window.fetch = patchedFetch;
      return; // success
    } catch { /* read-only — try defineProperty */ }

    // Try Object.defineProperty for strict environments like Next.js 13+
    Object.defineProperty(window, "fetch", {
      value: patchedFetch,
      writable: true,
      configurable: true,
    });

  } catch {
    // fetch patching completely blocked — skip silently
    // all other error types still captured
  }
}

// ─── Browser Listeners ────────────────────────────────────────────────────────

function activateBrowserListeners() {
  // 1 — JS errors + resource errors
  try {
    window.addEventListener("error", (event) => {
      try {
        // Resource load errors
        const target = event.target as HTMLElement;
        if (target && target.tagName && ["IMG", "SCRIPT", "LINK", "VIDEO", "AUDIO"].includes(target.tagName)) {
          const src = (target as any).src || (target as any).href || "unknown";
          enqueue(buildErrorPayload({
            name: "ResourceError",
            message: `${target.tagName} failed to load: ${src}`,
            stack: "",
          }, "resource"));
          return;
        }

        // JS runtime errors
        const err = (event as ErrorEvent).error || {
          name: "Error",
          message: (event as ErrorEvent).message || "Unknown error",
          stack: `at ${(event as ErrorEvent).filename}:${(event as ErrorEvent).lineno}:${(event as ErrorEvent).colno}`,
        };
        enqueue(buildErrorPayload(err, "window"));
      } catch { /* silent */ }
    }, true);
  } catch { /* silent */ }

  // 2 — Unhandled promise rejections
  try {
    window.addEventListener("unhandledrejection", (event) => {
      try {
        const err = event.reason instanceof Error
          ? event.reason
          : { name: "UnhandledRejection", message: String(event.reason || "Unhandled Promise Rejection"), stack: "" };
        enqueue(buildErrorPayload(err, "unhandledrejection"));
      } catch { /* silent */ }
    });
  } catch { /* silent */ }

  // 3 — Fetch interception
  patchFetch();

  // 4 — XHR interception
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

        if (!url.includes("fahikyfmgdyzejdfftox.supabase.co")) {
          this.addEventListener("loadend", () => {
            try {
              if (this.status >= 400 || this.status === 0) {
                enqueue(buildErrorPayload({
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

  // 5 — Disconnect when page closes
  try {
    window.addEventListener("beforeunload", () => {
      try {
        const row = JSON.stringify({
          api_key: _config?.apiKey,
          error_message: "SDK disconnected",
          payload: {
            type: "SDK_DISCONNECTED",
            timestamp: new Date().toISOString(),
            environment: getEnvironment(),
            url: getUrl(),
          },
          processed: true,
        });
        navigator.sendBeacon(REPORTLI_URL, row);
      } catch { /* silent */ }
    });
  } catch { /* silent */ }
}

// ─── Server Listeners ─────────────────────────────────────────────────────────

function activateServerListeners() {
  try {
    process.on("uncaughtException", (error: Error) => {
      try {
        enqueue(buildErrorPayload(error, "uncaughtException"));
        flush();
      } catch { /* silent */ }
    });
  } catch { /* silent */ }

  try {
    process.on("unhandledRejection", (reason: any) => {
      try {
        enqueue(buildErrorPayload(
          reason instanceof Error ? reason : { name: "UnhandledRejection", message: String(reason), stack: "" },
          "unhandledrejection"
        ));
      } catch { /* silent */ }
    });
  } catch { /* silent */ }

  const shutdown = async (signal: string) => {
    try {
      await saveRow({
        type: "SDK_DISCONNECTED",
        message: "SDK disconnected",
        signal,
        timestamp: new Date().toISOString(),
        environment: getEnvironment(),
        url: getUrl(),
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

      // Save SDK_INITIALIZED immediately
      saveImmediate({
        type: "SDK_INITIALIZED",
        message: "SDK connected successfully",
        timestamp: new Date().toISOString(),
        environment: getEnvironment(),
        url: getUrl(),
        browser: getBrowser(),
      });

      // Activate listeners based on environment
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
      enqueue(buildErrorPayload(err, "manual"));
    } catch { /* silent */ }
  },

  captureMessage(message: string): void {
    try {
      if (!initialized) return;
      enqueue(buildErrorPayload({ name: "Message", message, stack: "" }, "manual"));
    } catch { /* silent */ }
  },

  errorHandler() {
    return function (err: any, _req: any, _res: any, next: any) {
      try { enqueue(buildErrorPayload(err, "express")); } catch { /* silent */ }
      next(err);
    };
  },
};

export default Reportli;

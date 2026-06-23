// src/index.ts — Reportli SDK v1.0.3

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

// ─── Queue & Batch Send ───────────────────────────────────────────────────────

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, 2000); // batch every 2 seconds
}

async function flush() {
  if (isFlushing || queue.length === 0) return;
  isFlushing = true;

  const batch = queue.splice(0, 10); // max 10 per batch

  for (const payload of batch) {
    await saveToReportli(payload);
  }

  isFlushing = false;

  if (queue.length > 0) flush(); // flush remaining
}

async function saveToReportli(payload: QueueItem, attempts = 3): Promise<void> {
  // Build the row that matches exact_errors table columns exactly
  const row = {
    api_key: _config?.apiKey ?? "",
    error_message: buildErrorMessage(payload),
    payload: payload,
    processed: false,
  };

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(REPORTLI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": REPORTLI_KEY,
          "Authorization": `Bearer ${REPORTLI_KEY}`,
          "Prefer": "return=minimal",
        },
        body: JSON.stringify(row),
      });
      if (res.ok || res.status === 201) return; // success
    } catch {
      // network error — wait before retry
    }
    await sleep(1000 * (i + 1)); // 1s, 2s, 3s
  }
  // give up silently — never crash user app
}

function saveImmediate(payload: QueueItem) {
  saveToReportli(payload).catch(() => {}); // fire and forget
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Enqueue ──────────────────────────────────────────────────────────────────

function enqueue(payload: QueueItem) {
  if (queue.length >= 100) return; // cap queue — prevent memory issues
  queue.push(payload);
  scheduleFlush();
}

// ─── Build human readable error message ───────────────────────────────────────

function buildErrorMessage(payload: QueueItem): string {
  const parts: string[] = [];
  if (payload.error_category) parts.push(`[${payload.error_category}]`);
  if (payload.message) parts.push(String(payload.message));
  if (payload.file && payload.file !== "unknown") parts.push(`in ${payload.file}`);
  if (payload.line && payload.line !== 0) parts.push(`at line ${payload.line}`);
  if (payload.column && payload.column !== 0) parts.push(`column ${payload.column}`);
  if (payload.severity) parts.push(`— severity: ${payload.severity}`);
  if (payload.url) parts.push(`— url: ${payload.url}`);
  return parts.join(" ") || "Unknown error";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getUrl(): string {
  if (typeof window !== "undefined") return window.location.href;
  try { return require("os").hostname(); } catch { return "server"; }
}

function getBrowser(): string {
  if (typeof navigator !== "undefined") return navigator.userAgent;
  return `Node.js ${typeof process !== "undefined" ? process.version : "unknown"}`;
}

function getEnvironment(): string {
  return _config?.environment ?? (typeof window !== "undefined" ? "browser" : "server");
}

function parseStack(stack: string | undefined): { file: string; line: number; column: number } {
  if (!stack) return { file: "unknown", line: 0, column: 0 };
  const match =
    stack.match(/at .+ \((.+):(\d+):(\d+)\)/) ||
    stack.match(/at (.+):(\d+):(\d+)/);
  return {
    file: match?.[1]?.split("/")?.pop() || "unknown",
    line: parseInt(match?.[2] || "0"),
    column: parseInt(match?.[3] || "0"),
  };
}

function getErrorCode(error: any): string {
  return (
    error?.code ||
    error?.status?.toString() ||
    error?.statusCode?.toString() ||
    error?.name ||
    "ERR_UNKNOWN"
  );
}

function classifyError(error: any, context?: string): { category: string; severity: "low" | "medium" | "high" | "critical" } {
  const msg = String(error?.message || error || "").toLowerCase();
  const name = String(error?.name || "").toLowerCase();

  // Payment — always critical
  if (msg.includes("stripe") || msg.includes("payment") || msg.includes("card declined") || msg.includes("checkout") || msg.includes("refund"))
    return { category: "Payment Error", severity: "critical" };

  // Auth
  if (msg.includes("jwt") || msg.includes("token expired") || msg.includes("unauthorized") || msg.includes("session") || msg.includes("oauth") || msg.includes("login failed"))
    return { category: "Auth Error", severity: "high" };

  // Database
  if (msg.includes("supabase") || msg.includes("database") || msg.includes("query") || msg.includes("connection lost") || msg.includes("transaction") || msg.includes("duplicate key") || msg.includes("foreign key"))
    return { category: "Database Error", severity: "critical" };

  // React/Next.js
  if (msg.includes("hydration") || msg.includes("does not match server"))
    return { category: "Hydration Error", severity: "high" };
  if (msg.includes("invalid hook") || msg.includes("rules of hooks"))
    return { category: "Hook Error", severity: "critical" };
  if (msg.includes("render") || msg.includes("error boundary"))
    return { category: "Render Error", severity: "critical" };
  if (msg.includes("dynamic import") || msg.includes("failed to fetch dynamically"))
    return { category: "Import Error", severity: "high" };

  // Network
  if (msg.includes("cors") || msg.includes("cross-origin"))
    return { category: "CORS Error", severity: "high" };
  if (msg.includes("fetch failed") || msg.includes("failed to fetch") || name === "fetcherror")
    return { category: "Network Error", severity: "high" };
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout"))
    return { category: "Timeout Error", severity: "medium" };
  if (msg.includes("websocket"))
    return { category: "WebSocket Error", severity: "high" };

  // HTTP status codes
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

  // Memory
  if (msg.includes("maximum call stack") || msg.includes("out of memory") || msg.includes("heap limit"))
    return { category: "Memory Error", severity: "critical" };

  // Server
  if (msg.includes("cannot find module") || msg.includes("module not found"))
    return { category: "Module Error", severity: "critical" };
  if (msg.includes("econnrefused") || msg.includes("connection refused"))
    return { category: "Connection Error", severity: "critical" };

  // Email & Jobs
  if (msg.includes("email") || msg.includes("smtp") || msg.includes("sendgrid"))
    return { category: "Email Error", severity: "high" };
  if (msg.includes("cron") || msg.includes("webhook") || msg.includes("queue"))
    return { category: "Job Error", severity: "high" };

  // Files
  if (msg.includes("upload") || msg.includes("file size") || msg.includes("invalid file"))
    return { category: "File Error", severity: "medium" };

  // Storage
  if (msg.includes("quota exceeded") || msg.includes("localstorage") || msg.includes("indexeddb"))
    return { category: "Storage Error", severity: "medium" };

  // JS core
  if (name === "typeerror") return { category: "TypeError", severity: "high" };
  if (name === "referenceerror") return { category: "ReferenceError", severity: "critical" };
  if (name === "rangeerror") return { category: "RangeError", severity: "high" };
  if (name === "syntaxerror") return { category: "SyntaxError", severity: "high" };

  // Context based
  if (context === "unhandledrejection") return { category: "Promise Error", severity: "medium" };
  if (context === "express") return { category: "Server Error", severity: "high" };
  if (context === "resource") return { category: "Resource Error", severity: "low" };

  return { category: "Unknown Error", severity: "medium" };
}

function buildErrorPayload(error: any, context?: string): QueueItem {
  const message = error?.message || String(error) || "Unknown error";
  const stack = error?.stack || "";
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
}

// ─── Browser Listeners ────────────────────────────────────────────────────────

function activateBrowserListeners() {
  // Never intercept requests to Reportli itself
  const isReportliUrl = (url: string) =>
    url.includes("fahikyfmgdyzejdfftox.supabase.co");

  // JS errors + resource errors
  window.addEventListener("error", (event) => {
    // Resource load errors (img, script, link, video, audio)
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

    const err = (event as ErrorEvent).error || {
      name: "Error",
      message: (event as ErrorEvent).message,
      stack: `at ${(event as ErrorEvent).filename}:${(event as ErrorEvent).lineno}:${(event as ErrorEvent).colno}`,
    };
    enqueue(buildErrorPayload(err, "window"));
  }, true);

  // Unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const err = event.reason instanceof Error
      ? event.reason
      : { name: "UnhandledRejection", message: String(event.reason || "Unhandled Promise Rejection"), stack: "" };
    enqueue(buildErrorPayload(err, "unhandledrejection"));
  });

  // Intercept fetch — catches all API errors automatically
  const originalFetch = window.fetch;
  window.fetch = async function (...args: Parameters<typeof fetch>): Promise<Response> {
    const url = typeof args[0] === "string"
      ? args[0]
      : args[0] instanceof URL
      ? args[0].toString()
      : (args[0] as Request)?.url ?? "";

    // Never intercept Reportli's own requests
    if (isReportliUrl(url)) return originalFetch(...args);

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
        message: `Fetch failed: ${(args[1] as RequestInit)?.method || "GET"} ${url} — ${err.message}`,
        stack: err.stack,
      }, "fetch"));
      throw err;
    }
  };

  // Intercept XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: any[]) {
    (this as any)._r_method = method;
    (this as any)._r_url = url;
    return originalOpen.call(this, method, url, ...rest);
  } as any;

  XMLHttpRequest.prototype.send = function (...args: any[]) {
    const url: string = (this as any)._r_url || "";
    const method: string = (this as any)._r_method || "GET";

    if (!isReportliUrl(url)) {
      this.addEventListener("loadend", () => {
        if (this.status >= 400 || this.status === 0) {
          enqueue(buildErrorPayload({
            name: `XHR_${this.status}`,
            message: `XHR ${this.status}: ${method} ${url}`,
            stack: `${method} ${url} → ${this.status} ${this.statusText}`,
            status: this.status,
          }, "xhr"));
        }
      });
    }

    return originalSend.apply(this, args);
  } as any;

  // Send disconnect when page closes
  window.addEventListener("beforeunload", () => {
    try {
      const row = {
        api_key: _config?.apiKey,
        error_message: "SDK disconnected",
        payload: {
          type: "SDK_DISCONNECTED",
          timestamp: new Date().toISOString(),
          environment: getEnvironment(),
          url: getUrl(),
        },
        processed: true,
      };
      navigator.sendBeacon(
        REPORTLI_URL,
        JSON.stringify(row)
      );
    } catch { /* silent */ }
  });
}

// ─── Server Listeners ─────────────────────────────────────────────────────────

function activateServerListeners() {
  process.on("uncaughtException", (error: Error) => {
    enqueue(buildErrorPayload(error, "uncaughtException"));
    flush(); // flush immediately on crash
  });

  process.on("unhandledRejection", (reason: any) => {
    enqueue(buildErrorPayload(
      reason instanceof Error ? reason : { name: "UnhandledRejection", message: String(reason), stack: "" },
      "unhandledrejection"
    ));
  });

  const shutdown = async (signal: string) => {
    // Save disconnect row before shutting down
    await saveToReportli({
      type: "SDK_DISCONNECTED",
      message: "SDK disconnected",
      signal,
      timestamp: new Date().toISOString(),
      environment: getEnvironment(),
      url: getUrl(),
    });
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// ─── Public API ───────────────────────────────────────────────────────────────

export const Reportli = {
  init(cfg: Config) {
    if (initialized) return;
    if (!cfg?.apiKey) return;

    _config = cfg;
    initialized = true;

    // Save SDK_INITIALIZED row immediately
    saveImmediate({
      type: "SDK_INITIALIZED",
      message: "SDK connected successfully",
      timestamp: new Date().toISOString(),
      environment: getEnvironment(),
      url: getUrl(),
      browser: getBrowser(),
    });

    // Activate listeners
    if (typeof window !== "undefined") {
      activateBrowserListeners();
    } else if (typeof process !== "undefined" && process.versions?.node) {
      activateServerListeners();
    }
  },

  capture(error: unknown) {
    if (!initialized) return;
    const err = error instanceof Error
      ? error
      : { name: "ManualCapture", message: String(error), stack: new Error().stack };
    enqueue(buildErrorPayload(err, "manual"));
  },

  captureMessage(message: string) {
    if (!initialized) return;
    enqueue(buildErrorPayload({ name: "Message", message, stack: "" }, "manual"));
  },

  errorHandler() {
    return function (err: any, _req: any, _res: any, next: any) {
      enqueue(buildErrorPayload(err, "express"));
      next(err);
    };
  },
};

export default Reportli;

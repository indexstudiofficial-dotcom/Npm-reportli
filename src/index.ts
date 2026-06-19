/**
 * Reportli SDK v1.0.1
 * Your AI agent that never sleeps.
 * Watches your SaaS, catches every error, files the GitHub issue — automatically.
 */

const ENDPOINT = "https://fahikyfmgdyzejdfftox.supabase.co/functions/v1/rapid-processor";

const isBrowser = typeof window !== "undefined";
const isNode = typeof process !== "undefined" && !!(process.versions?.node);

let _apiKey = "";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEnvironment(): string {
  return isBrowser ? "browser" : "server";
}

function getUrl(): string {
  if (isBrowser) return window.location.href;
  try { return require("os").hostname(); } catch { return "server"; }
}

function getBrowser(): string {
  if (isBrowser) return navigator.userAgent;
  return `Node.js ${typeof process !== "undefined" ? process.version : "unknown"}`;
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
  return error?.code || error?.status?.toString() || error?.statusCode?.toString() || error?.name || "ERR_UNKNOWN";
}

function classifyError(error: any, context?: string): { errorType: string; severity: "low" | "medium" | "high" | "critical" } {
  const msg = String(error?.message || error || "").toLowerCase();
  const name = String(error?.name || "").toLowerCase();

  if (name.includes("quotaexceeded") || msg.includes("quota exceeded") || msg.includes("localstorage") || msg.includes("indexeddb"))
    return { errorType: "localStorage quota exceeded", severity: "medium" };
  if (msg.includes("hydration") || msg.includes("does not match server"))
    return { errorType: "React hydration error", severity: "high" };
  if (msg.includes("invalid hook call") || msg.includes("rules of hooks"))
    return { errorType: "Invalid hook call error", severity: "critical" };
  if (msg.includes("failed prop type") || msg.includes("invalid prop"))
    return { errorType: "Props type error", severity: "low" };
  if (msg.includes("render") || msg.includes("react error boundary"))
    return { errorType: "Component render error", severity: "critical" };
  if (msg.includes("route not found") || msg.includes("404 route"))
    return { errorType: "Route not found error", severity: "medium" };
  if (msg.includes("failed to fetch dynamically imported") || msg.includes("dynamic import"))
    return { errorType: "Dynamic import error", severity: "high" };
  if (msg.includes("suspense"))
    return { errorType: "Suspense boundary error", severity: "medium" };
  if (name === "typeerror" || msg.startsWith("typeerror"))
    return { errorType: "TypeError", severity: "high" };
  if (name === "referenceerror")
    return { errorType: "ReferenceError", severity: "critical" };
  if (name === "rangeerror" || msg.includes("maximum call stack"))
    return { errorType: "Stack overflow error", severity: "critical" };
  if (name === "syntaxerror")
    return { errorType: "SyntaxError", severity: "high" };
  if (msg.includes("stripe") && (msg.includes("init") || msg.includes("key")))
    return { errorType: "Stripe initialization error", severity: "critical" };
  if (msg.includes("payment") || msg.includes("card declined"))
    return { errorType: "Payment processing error", severity: "critical" };
  if (msg.includes("checkout session"))
    return { errorType: "Checkout session error", severity: "high" };
  if (msg.includes("refund failed"))
    return { errorType: "Refund failed error", severity: "high" };
  if (msg.includes("supabase") || msg.includes("postgresterror"))
    return { errorType: "Supabase query error", severity: "critical" };
  if (msg.includes("unique constraint") || msg.includes("duplicate key"))
    return { errorType: "Unique constraint error", severity: "high" };
  if (msg.includes("foreign key"))
    return { errorType: "Foreign key error", severity: "high" };
  if (msg.includes("transaction failed") || msg.includes("rollback"))
    return { errorType: "Transaction failed error", severity: "critical" };
  if (msg.includes("connection lost") || msg.includes("econnrefused"))
    return { errorType: "Connection lost error", severity: "critical" };
  if (msg.includes("query timeout"))
    return { errorType: "Query timeout error", severity: "high" };
  if (msg.includes("jwt expired") || msg.includes("token expired"))
    return { errorType: "JWT expired error", severity: "high" };
  if (msg.includes("jwt") && msg.includes("invalid"))
    return { errorType: "JWT verification error", severity: "high" };
  if (msg.includes("firebase admin"))
    return { errorType: "Firebase admin error", severity: "critical" };
  if (msg.includes("unauthorized") || msg.includes("permission denied"))
    return { errorType: "Unauthorized access error", severity: "high" };
  if (msg.includes("login failed") || msg.includes("invalid credentials"))
    return { errorType: "Login failed error", severity: "medium" };
  if (msg.includes("session ended") || msg.includes("session expired"))
    return { errorType: "Session ended error", severity: "medium" };
  if (msg.includes("oauth"))
    return { errorType: "OAuth callback error", severity: "high" };
  if (msg.includes("cron job") || msg.includes("cron failed"))
    return { errorType: "Cron job failed", severity: "high" };
  if (msg.includes("queue processing") || msg.includes("bullmq"))
    return { errorType: "Queue processing error", severity: "high" };
  if (msg.includes("webhook"))
    return { errorType: "Webhook delivery failed", severity: "high" };
  if (msg.includes("retry limit"))
    return { errorType: "Retry limit exceeded", severity: "high" };
  if (msg.includes("out of memory") || msg.includes("heap limit"))
    return { errorType: "Out of memory error", severity: "critical" };
  if (msg.includes("cannot find module"))
    return { errorType: "Module not found error", severity: "critical" };
  if (msg.includes("email") || msg.includes("smtp") || msg.includes("sendgrid") || msg.includes("nodemailer"))
    return { errorType: "Email sending failed", severity: "high" };
  if (msg.includes("onesignal") || msg.includes("push notification"))
    return { errorType: "OneSignal API error", severity: "high" };
  if (msg.includes("file upload") || msg.includes("upload failed"))
    return { errorType: "File upload failed", severity: "high" };
  if (msg.includes("file size exceeded") || msg.includes("payload too large"))
    return { errorType: "File size exceeded", severity: "medium" };
  if (msg.includes("invalid file type") || msg.includes("mime type"))
    return { errorType: "Invalid file type", severity: "medium" };
  if (msg.includes("cors") || msg.includes("cross-origin"))
    return { errorType: "CORS error", severity: "high" };
  if (msg.includes("fetch failed") || msg.includes("failed to fetch"))
    return { errorType: "Fetch failed error", severity: "high" };
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("etimedout"))
    return { errorType: "Request timeout error", severity: "medium" };
  if (msg.includes("websocket"))
    return { errorType: "WebSocket connection error", severity: "high" };
  if (context === "unhandledrejection")
    return { errorType: "Unhandled promise rejection", severity: "medium" };
  if (context === "uncaughtexception")
    return { errorType: "Uncaught exception", severity: "high" };
  if (context === "express")
    return { errorType: "Route handler error", severity: "high" };
  return { errorType: "Uncaught exception", severity: "medium" };
}

function normalizeError(err: any): { name: string; message: string; stack?: string } {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  if (typeof err === "string") return { name: "Error", message: err, stack: new Error(err).stack };
  if (err && typeof err === "object") return {
    name: err.name || err.code || "Error",
    message: err.message || err.reason || JSON.stringify(err),
    stack: err.stack || new Error(err.message).stack,
  };
  return { name: "Error", message: "Unknown error", stack: new Error().stack };
}

// ─── Send ─────────────────────────────────────────────────────────────────────

async function send(payload: object): Promise<void> {
  try {
    if ((payload as any).message?.includes("rapid-processor")) return;
    await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": _apiKey,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // Fail silently — never break user app
  }
}

// ─── Build error payload ──────────────────────────────────────────────────────

function buildErrorPayload(error: any, context?: string): object {
  const normalized = normalizeError(error);
  const { file, line, column } = parseStack(normalized.stack);
  const { errorType, severity } = classifyError(normalized, context);

  return {
    type: "ERROR",
    apiKey: _apiKey,
    message: normalized.message,
    code: getErrorCode(error),
    stack: normalized.stack || "",
    file,
    line,
    column,
    url: getUrl(),
    timestamp: new Date().toISOString(),
    environment: getEnvironment(),
    browser: getBrowser(),
    error_category: errorType,
    severity,
    status: "open",
  };
}

// ─── Browser listeners ────────────────────────────────────────────────────────

function activateBrowserListeners(): void {
  // JS runtime errors + resource load errors
  window.addEventListener("error", (event) => {
    if ((event as any).filename?.includes("rapid-processor")) return;

    const target = event.target as HTMLElement;
    if (target && target.tagName) {
      const tag = target.tagName;
      const src = (target as any).src || (target as any).href || "";
      if (["IMG", "SCRIPT", "LINK", "VIDEO", "AUDIO", "SOURCE"].includes(tag)) {
        send(buildErrorPayload({
          name: "ResourceError",
          message: `${tag} failed to load: ${src}`,
          stack: `at ${window.location.href}`,
        }));
        return;
      }
    }

    const err = (event as ErrorEvent).error || {
      name: "Error",
      message: (event as ErrorEvent).message,
      stack: `${(event as ErrorEvent).message} at ${(event as ErrorEvent).filename}:${(event as ErrorEvent).lineno}:${(event as ErrorEvent).colno}`,
    };
    send(buildErrorPayload(err));
  }, true);

  // Unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    send(buildErrorPayload(event.reason || { message: "Unhandled Promise Rejection" }, "unhandledrejection"));
  });

  // Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : (input as Request).url);
    if (url.includes("rapid-processor") || url.includes("supabase.co/functions")) {
      return originalFetch.apply(this, arguments as any);
    }
    try {
      const response = await originalFetch.apply(this, arguments as any);
      if (!response.ok) {
        send(buildErrorPayload({
          name: `API ${response.status} Error`,
          message: `HTTP ${response.status}: ${init?.method || "GET"} ${url}`,
          stack: `${init?.method || "GET"} ${url} → ${response.status} ${response.statusText}`,
          status: response.status,
        }));
      }
      return response;
    } catch (err: any) {
      send(buildErrorPayload({
        name: "FetchError",
        message: `Fetch failed: ${init?.method || "GET"} ${url} — ${err.message}`,
        stack: err.stack,
      }));
      throw err;
    }
  };

  // Intercept XHR
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string) {
    (this as any)._r_method = method;
    (this as any)._r_url = url;
    return originalOpen.apply(this, arguments as any);
  } as any;

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("loadend", () => {
      const url: string = (this as any)._r_url || "";
      const method: string = (this as any)._r_method || "GET";
      if (url.includes("rapid-processor")) return;
      if (this.status >= 400 || this.status === 0) {
        send(buildErrorPayload({
          name: `XHR ${this.status} Error`,
          message: `XHR ${this.status}: ${method} ${url}`,
          stack: `${method} ${url} → ${this.status} ${this.statusText}`,
          status: this.status,
        }));
      }
    });
    return originalSend.apply(this, arguments as any);
  } as any;

  // Disconnect when page closes
  window.addEventListener("beforeunload", () => {
    try {
      navigator.sendBeacon(ENDPOINT, JSON.stringify({
        type: "SDK_DISCONNECTED",
        apiKey: _apiKey,
        timestamp: new Date().toISOString(),
        environment: "browser",
        url: getUrl(),
      }));
    } catch { /* silent */ }
  });
}

// ─── Server listeners ─────────────────────────────────────────────────────────

function activateServerListeners(): void {
  process.on("uncaughtException", (error: Error) => {
    send(buildErrorPayload(error, "uncaughtexception"));
  });

  process.on("unhandledRejection", (reason: any) => {
    send(buildErrorPayload(
      reason instanceof Error ? reason : { name: "UnhandledRejection", message: String(reason), stack: "" },
      "unhandledrejection"
    ));
  });

  const shutdown = async () => {
    await send({
      type: "SDK_DISCONNECTED",
      apiKey: _apiKey,
      timestamp: new Date().toISOString(),
      environment: "server",
      url: getUrl(),
    });
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

// ─── Public API ───────────────────────────────────────────────────────────────

const Reportli = {
  init({ apiKey }: { apiKey: string }): void {
    if (!apiKey || _apiKey) return;
    _apiKey = apiKey;

    // Send SDK_INITIALIZED once only
    if (isBrowser && typeof localStorage !== "undefined") {
      const key = `reportli_init_${apiKey}`;
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, "true");
        send({
          type: "SDK_INITIALIZED",
          apiKey: _apiKey,
          timestamp: new Date().toISOString(),
          environment: getEnvironment(),
          url: getUrl(),
          browser: getBrowser(),
        });
      }
    } else {
      send({
        type: "SDK_INITIALIZED",
        apiKey: _apiKey,
        timestamp: new Date().toISOString(),
        environment: getEnvironment(),
        url: getUrl(),
        browser: getBrowser(),
      });
    }

    if (isBrowser) {
      activateBrowserListeners();
    } else if (isNode) {
      activateServerListeners();
    }
  },

  capture(error: any): void {
    if (!_apiKey) return;
    send(buildErrorPayload(error, "manual"));
  },

  errorHandler() {
    return function (err: any, _req: any, _res: any, next: any) {
      send(buildErrorPayload(err, "express"));
      next(err);
    };
  },
};

export default Reportli;
export { Reportli };

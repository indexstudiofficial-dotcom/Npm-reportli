// reportli.ts

const ENDPOINT =
  "https://fahikyfmgdyzejdfftox.supabase.co/functions/v1/rapid-processor";

type Config = {
  apiKey: string;
  environment?: string;
};

let initialized = false;
let config: Config;

function post(payload: Record<string, unknown>) {
  fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Never throw from the SDK.
  });
}

function sendError(data: {
  message: string;
  code?: string;
  stack?: string;
  file?: string;
  line?: number;
  column?: number;
  severity?: string;
}) {
  post({
    type: "ERROR",
    apiKey: config.apiKey,
    message: data.message,
    code: data.code ?? "Error",
    stack: data.stack ?? null,
    file: data.file ?? null,
    line: data.line ?? null,
    column: data.column ?? null,
    url:
      typeof window !== "undefined" ? window.location.href : null,
    timestamp: new Date().toISOString(),
    environment: config.environment ?? "production",
    browser:
      typeof navigator !== "undefined"
        ? navigator.userAgent
        : "node",
    error_category: data.code ?? "Error",
    severity: data.severity ?? "high",
    status: "open",
  });
}

export const Reportli = {
  init(cfg: Config) {
    if (initialized) return;

    config = cfg;
    initialized = true;

    console.log(
      "✅ Reportli initialized successfully. Error monitoring is active."
    );

    // JS errors
    window.addEventListener("error", (event: any) => {
      if (event.error instanceof Error) {
        sendError({
          message: event.error.message,
          code: event.error.name,
          stack: event.error.stack,
          file: event.filename,
          line: event.lineno,
          column: event.colno,
        });
      } else if (event.target) {
        // Resource load failure
        sendError({
          message: "Resource failed to load",
          code: "ResourceLoadError",
        });
      }
    }, true);

    // Promise rejections
    window.addEventListener("unhandledrejection", (event: any) => {
      const err = event.reason;
      sendError({
        message: err?.message ?? String(err),
        code: err?.name ?? "UnhandledPromiseRejection",
        stack: err?.stack,
      });
    });

    // fetch interception
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);

        if (!response.ok) {
          sendError({
            message: `Fetch HTTP ${response.status}`,
            code: `HTTP_${response.status}`,
            severity: "medium",
          });
        }

        return response;
      } catch (e: any) {
        sendError({
          message: e?.message ?? "Fetch failed",
          code: "FetchError",
          stack: e?.stack,
        });
        throw e;
      }
    };

    // XMLHttpRequest interception
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (
      method,
      url,
      ...rest
    ) {
      (this as any).__reportli_url = url;
      return open.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...args) {
      this.addEventListener("load", function () {
        if (this.status >= 400) {
          sendError({
            message: `XHR HTTP ${this.status}`,
            code: `XHR_${this.status}`,
          });
        }
      });

      this.addEventListener("error", function () {
        sendError({
          message: "XHR connection failed",
          code: "XHRConnectionError",
        });
      });

      return send.apply(this, args as any);
    };
  },

  capture(error: unknown) {
    if (error instanceof Error) {
      sendError({
        message: error.message,
        code: error.name,
        stack: error.stack,
      });
    } else {
      sendError({
        message: String(error),
        code: "ManualCapture",
      });
    }
  },

  captureMessage(message: string) {
    sendError({
      message,
      code: "Message",
      severity: "low",
    });
  },
};
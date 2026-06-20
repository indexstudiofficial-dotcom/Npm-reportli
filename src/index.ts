/**
 * Reportli SDK
 * Enterprise-grade real-time exception tracking and AI diagnostic companion.
 */

export interface ReportliConfig {
  apiKey: string;
  projectId?: string;
  projectName?: string;
  environment?: string;
  framework?: string;
  disableHmrLogging?: boolean;
  captureUnhandledRejections?: boolean;
  autoCreateGitHubIssues?: boolean;
  userEmail?: string;
  endpoint?: string;
}

export interface ExceptionPayload {
  apiKey: string;
  projectId?: string;
  projectName?: string;
  errorType: string;
  errorMessage: string;
  errorStack: string;
  framework?: string;
  user_email?: string;
  severity?: "low" | "medium" | "high" | "critical";
  status?: string;
}

const isBrowser = typeof window !== "undefined";

const REPORTLI_BASE_URL = "https://ais-dev-ohcojup63zslqou25sisle-541405064838.asia-east1.run.app";

class ReportliTracker {
  private config: ReportliConfig | null = null;
  private isInitialized = false;

  /**
   * Initializes the Reportli tracker with your secure project credentials.
   */
  public init(config: ReportliConfig): void {
    if (!config || !config.apiKey) {
      console.error("[Reportli SDK] Initialization failed: 'apiKey' is required.");
      return;
    }

    if (this.isInitialized) {
      return; // Already active in thread
    }

    this.config = {
      environment: "production",
      captureUnhandledRejections: true,
      autoCreateGitHubIssues: true,
      ...config,
    };
    this.isInitialized = true;

    const isBrowser = typeof window !== "undefined";
    const isNode = typeof process !== "undefined" && process.versions && process.versions.node;

    // A static flag to prevent multiple registration sends per runtime instance
    if ((ReportliTracker as any)._registrationSent) {
      return;
    }

    // 1. Send the installation/setup success message on initial setup block
    this.sendRegistrationWebhook(isBrowser);
    (ReportliTracker as any)._registrationSent = true;

    // 2. Setup standard listeners
    if (isBrowser) {
      this.setupBrowserListeners();
    } else if (isNode) {
      this.setupNodeListeners();
    }

    console.log("[Reportli SDK] Exception listener successfully initialized.");
  }

  /**
   * Manually captures and files a custom application exception with custom severity.
   */
  public captureException(error: Error | any, severityInput?: "low" | "medium" | "high" | "critical"): void {
    if (!this.isInitialized || !this.config) {
      console.warn("[Reportli SDK] Capture failed: SDK is not initialized yet.");
      return;
    }

    const errorObject = this.normalizeError(error);
    const { errorType, severity } = this.classifyError(errorObject);

    const payload: ExceptionPayload = {
      apiKey: this.config.apiKey,
      projectId: this.config.projectId || "proj-sandbox",
      projectName: this.config.projectName || "SaaS App",
      errorType: errorType,
      errorMessage: errorObject.message || "Manual trace reported",
      errorStack: errorObject.stack || "",
      framework: this.config.framework || (typeof window !== "undefined" ? "React/Next.js Client" : "Node.js Server"),
      user_email: this.config.userEmail || "anonymous",
      severity: severityInput || severity,
      status: "open"
    };

    this.sendCrashReport(payload);
  }

  /**
   * Express error handler middleware
   */
  public expressErrorHandler = (err: any, req: any, res: any, next: any): void => {
    if (this.isInitialized && this.config) {
      try {
        const errorObject = this.normalizeError(err);
        const { errorType, severity } = this.classifyError(errorObject, "express");

        const payload: ExceptionPayload = {
          apiKey: this.config.apiKey,
          projectId: this.config.projectId || "express-server",
          projectName: this.config.projectName || "Express App",
          errorType: errorType || "Route handler error",
          errorMessage: `${req.method} ${req.url} - ${errorObject.message}`,
          errorStack: errorObject.stack || "",
          framework: this.config.framework || "Express",
          user_email: this.config.userEmail || req.user?.email || "anonymous",
          severity: severity || "high",
          status: "open"
        };

        this.sendCrashReport(payload);
      } catch (e) {
        console.error("[Reportli SDK] Failed to process express exception:", e);
      }
    }
    next(err);
  };

  /**
   * Registers global window listeners for DOM-based exceptions.
   */
  private setupBrowserListeners(): void {
    if (typeof window === "undefined") return;

    // A. Uncaught JavaScript Runtime Crashes
    window.addEventListener("error", (event) => {
      // Prevent loop tracing reportli requests
      if (event.filename && event.filename.includes("rapid-processor")) return;

      try {
        const error = event.error || {
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          stack: `${event.message} at ${event.filename}:${event.lineno}:${event.colno}`,
        };

        const errorObject = this.normalizeError(error);
        const { errorType, severity } = this.classifyError(errorObject);

        const payload: ExceptionPayload = {
          apiKey: this.config?.apiKey || "",
          projectId: this.config?.projectId || "proj-sandbox",
          projectName: this.config?.projectName || "SaaS App",
          errorType: errorType,
          errorMessage: errorObject.message,
          errorStack: errorObject.stack || "",
          framework: this.config?.framework || "React/Next.js Client",
          user_email: this.config?.userEmail || "anonymous",
          severity: severity,
          status: "open",
        };

        this.sendCrashReport(payload);
      } catch (err) {
        console.error("[Reportli SDK] Inner listener exception:", err);
      }
    });

    // B. Unhandled Promise Rejections (e.g. async/await loops)
    window.addEventListener("unhandledrejection", (event) => {
      try {
        const reason = event.reason;
        const errorObject = this.normalizeError(reason);
        const { errorType, severity } = this.classifyError(errorObject, "unhandledrejection");

        const payload: ExceptionPayload = {
          apiKey: this.config?.apiKey || "",
          projectId: this.config?.projectId || "proj-sandbox",
          projectName: this.config?.projectName || "SaaS App",
          errorType: errorType,
          errorMessage: `Unhandled Promise: ${errorObject.message}`,
          errorStack: errorObject.stack || "",
          framework: this.config?.framework || "React/Next.js Client",
          user_email: this.config?.userEmail || "anonymous",
          severity: severity,
          status: "open",
        };

        this.sendCrashReport(payload);
      } catch (err) {
        console.error("[Reportli SDK] Promise rejection listener exception:", err);
      }
    });

    // C. Resource loading errors (capture phase for elements failing to load)
    window.addEventListener(
      "error",
      (event) => {
        try {
          const target = event.target || event.srcElement;
          if (!target) return;

          const tagName = (target as HTMLElement).tagName;
          if (!tagName) return;

          let resourceType = "";
          let sourceUrl = "";

          if (tagName === "IMG") {
            resourceType = "Image failed to load";
            sourceUrl = (target as HTMLImageElement).src;
          } else if (tagName === "SCRIPT") {
            resourceType = "Script failed to load";
            sourceUrl = (target as HTMLScriptElement).src;
          } else if (tagName === "LINK") {
            resourceType = "CSS failed to load";
            sourceUrl = (target as HTMLLinkElement).href;
          } else if (tagName === "VIDEO" || tagName === "AUDIO") {
            resourceType = "Video failed to load";
            sourceUrl = (target as HTMLVideoElement).src;
          }

          if (resourceType) {
            const payload: ExceptionPayload = {
              apiKey: this.config?.apiKey || "",
              projectId: this.config?.projectId || "proj-sandbox",
              projectName: this.config?.projectName || "SaaS App",
              errorType: resourceType,
              errorMessage: `Failed to load static resource asset: ${sourceUrl}`,
              errorStack: `HTML Tag: <${tagName.toLowerCase()}> failed to download at location ${window.location.href}`,
              framework: this.config?.framework || "React/Next.js Client",
              user_email: this.config?.userEmail || "anonymous",
              severity: "low",
              status: "open",
            };
            this.sendCrashReport(payload);
          }
        } catch (err) {
          console.error("[Reportli SDK] Resource load listener failure:", err);
        }
      },
      true // capture phase is required for element errors
    );

    // D. Network Fetch Interceptors (Monkey patch global fetch to trace bad status codes)
    this.interceptFetch();
    this.interceptXhr();
  }

  /**
   * Registers node process listeners for server instances.
   */
  private setupNodeListeners(): void {
    if (typeof process === "undefined") return;

    process.on("uncaughtException", (error) => {
      try {
        const errorObject = this.normalizeError(error);
        const { errorType, severity } = this.classifyError(errorObject, "uncaughtexception");

        const payload: ExceptionPayload = {
          apiKey: this.config?.apiKey || "",
          projectId: this.config?.projectId || "node-server",
          projectName: this.config?.projectName || "Node Server",
          errorType: errorType,
          errorMessage: `Uncaught Exception: ${errorObject.message}`,
          errorStack: errorObject.stack || "",
          framework: this.config?.framework || "NodeJS backend",
          user_email: this.config?.userEmail || "anonymous",
          severity: severity,
          status: "open",
        };

        // Send-sync block
        this.sendCrashReport(payload);
      } catch (err) {
        console.error("[Reportli SDK] Node fatal uncaughtexception logging failed:", err);
      }
    });

    process.on("unhandledRejection", (reason) => {
      try {
        const errorObject = this.normalizeError(reason);
        const { errorType, severity } = this.classifyError(errorObject, "unhandledrejection");

        const payload: ExceptionPayload = {
          apiKey: this.config?.apiKey || "",
          projectId: this.config?.projectId || "node-server",
          projectName: this.config?.projectName || "Node Server",
          errorType: errorType,
          errorMessage: `Unhandled Rejection: ${errorObject.message}`,
          errorStack: errorObject.stack || "",
          framework: this.config?.framework || "NodeJS backend",
          user_email: this.config?.userEmail || "anonymous",
          severity: severity,
          status: "open",
        };

        this.sendCrashReport(payload);
      } catch (err) {
        console.error("[Reportli SDK] Node fatal unhandledrejection logging failed:", err);
      }
    });
  }

  /**
   * Safe payload sender with retry limits.
   */
  private async sendCrashReport(payload: ExceptionPayload): Promise<void> {
    try {
      // Avoid looping report-sends
      if (payload.errorMessage && (payload.errorMessage.includes("rapid-processor") || payload.errorMessage.includes("api/error") || payload.errorMessage.includes("supabase"))) {
        return;
      }

      // Default to the Reportli Production Server for NPM users
      let destinationUrl = this.config?.endpoint || `${REPORTLI_BASE_URL}/api/error`;
      
      const response = await fetch(destinationUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.config?.apiKey || ""
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // Fail silently to prevent user software crash
      console.warn("[Reportli SDK] Failed to synchronize crash traces to diagnostics server:", err);
    }
  }

  /**
   * Sends registration verification to user edge function on first install.
   */
  private sendRegistrationWebhook(isBrowser: boolean): void {
    if (!this.config) return;

    const key = `reportli_initialized_success_${this.config.apiKey}`;
    if (isBrowser && typeof localStorage !== "undefined") {
      if (localStorage.getItem(key)) {
        return; // Already verified registration autrefois
      }
      localStorage.setItem(key, "true");
    }

    const deviceDetails = isBrowser
      ? typeof navigator !== "undefined" ? navigator.userAgent : "Browser sandbox"
      : typeof process !== "undefined" ? `NodeJS environment: ${process.version}` : "Cloud instance";

    const welcomePayload: ExceptionPayload = {
      apiKey: this.config.apiKey,
      projectId: this.config.projectId || "proj-sandbox",
      projectName: this.config.projectName || "SaaS App Component",
      errorType: "SDK_INITIALIZED",
      errorMessage: "Reportli SDK successfully initialized! Error listener is active.",
      errorStack: `SDK Active Diagnostics: Success registration from execution agent. Device context: ${deviceDetails}`,
      framework: this.config.framework || (isBrowser ? "React/Next.js Client" : "Node.js Server"),
      user_email: this.config.userEmail || "anonymous",
      severity: "low",
      status: "info"
    };

    this.sendCrashReport(welcomePayload);
  }

  /**
   * Capture fetch network status deviations.
   */
  private interceptFetch(): void {
    if (typeof window === "undefined" || typeof window.fetch !== "function") return;

    const originalFetch = window.fetch;
    const self = this;

    window.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
      
      // Skip tracking of reportli's own API calls to avoid circular logging loop
      if (url.includes("rapid-processor") || url.includes("api/error") || url.includes("supabase.co/functions")) {
        return originalFetch.apply(this, arguments as any);
      }

      try {
        const response = await originalFetch.apply(this, arguments as any);
        if (response && !response.ok) {
          self.logNetworkError(url, response.status, response.statusText, init?.method || "GET");
        }
        return response;
      } catch (err: any) {
        // Fetch throwing means CORS, connection refused, dns failures or timeout aborts
        self.logNetworkFailure(url, err, init?.method || "GET");
        throw err;
      }
    };
  }

  /**
   * Trace XHR status failures.
   */
  private interceptXhr(): void {
    if (typeof window === "undefined" || typeof XMLHttpRequest === "undefined") return;

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const self = this;

    XMLHttpRequest.prototype.open = function (method: string, url: string) {
      (this as any)._reportli_method = method;
      (this as any)._reportli_url = url;
      return originalOpen.apply(this, arguments as any);
    } as any;

    XMLHttpRequest.prototype.send = function () {
      const xhrInstance = this;
      
      xhrInstance.addEventListener("loadend", () => {
        try {
          const url = (xhrInstance as any)._reportli_url || "";
          const method = (xhrInstance as any)._reportli_method || "GET";
          const status = xhrInstance.status;

          // Skip self calls
          if (url.includes("rapid-processor") || url.includes("supabase.co/functions")) {
            return;
          }

          if (status >= 400 || status === 0) {
            if (status === 0) {
              self.logNetworkFailure(url, new Error("CORS or Connection Refused"), method);
            } else {
              self.logNetworkError(url, status, xhrInstance.statusText || "XHR Error", method);
            }
          }
        } catch (e) {
          console.error("[Reportli SDK] Failed to extract XHR statistics:", e);
        }
      });

      return originalSend.apply(this, arguments as any);
    } as any;
  }

  private logNetworkError(url: string, status: number, statusText: string, method: string) {
    let errorType = `API ${status} Error`;
    let severity: "medium" | "high" | "critical" = "medium";

    if (status === 400) errorType = "API 400 Bad Request";
    else if (status === 401) { errorType = "API 401 Unauthorized"; severity = "high"; }
    else if (status === 403) { errorType = "API 403 Forbidden"; severity = "high"; }
    else if (status === 404) errorType = "API 404 Not Found";
    else if (status === 500) { errorType = "API 500 Internal Server Error"; severity = "high"; }
    else if (status === 503) { errorType = "API 503 Service Unavailable"; severity = "high"; }

    const payload: ExceptionPayload = {
      apiKey: this.config?.apiKey || "",
      projectId: this.config?.projectId || "proj-sandbox",
      projectName: this.config?.projectName || "SaaS App",
      errorType: errorType,
      errorMessage: `HTTP API failed with code ${status}: ${method} ${url}`,
      errorStack: `Network Request Header Context: [Method: ${method}] Url: ${url} Response Description: ${statusText || "Dev server returned error."}`,
      framework: this.config?.framework || "React/Next.js Client",
      user_email: this.config?.userEmail || "anonymous",
      severity: severity,
      status: "open",
    };

    this.sendCrashReport(payload);
  }

  private logNetworkFailure(url: string, error: Error | any, method: string) {
    const errorMsg = String(error.message || error || "");
    let errorType = "Fetch failed error";
    let severity: "medium" | "high" = "high";

    if (errorMsg.includes("timeout") || errorMsg.includes("abort")) {
      errorType = "Request timeout error";
      severity = "medium";
    } else if (errorMsg.includes("CORS") || errorMsg.includes("origin") || errorMsg.includes("Access-Control")) {
      errorType = "CORS error";
    }

    const payload: ExceptionPayload = {
      apiKey: this.config?.apiKey || "",
      projectId: this.config?.projectId || "proj-sandbox",
      projectName: this.config?.projectName || "SaaS App",
      errorType: errorType,
      errorMessage: `Failed to complete HTTP request: [${method}] ${url}`,
      errorStack: `Network crash context: ${errorMsg}\nConnection status: Failed to resolve.`,
      framework: this.config?.framework || "React/Next.js Client",
      user_email: this.config?.userEmail || "anonymous",
      severity: severity,
      status: "open",
    };

    this.sendCrashReport(payload);
  }

  /**
   * Helper to safely format raw objects / strings into structured Errors
   */
  private normalizeError(err: any): { name: string; message: string; stack?: string } {
    if (err instanceof Error) {
      return {
        name: err.name,
        message: err.message,
        stack: err.stack,
      };
    }

    if (typeof err === "string") {
      return {
        name: "Error",
        message: err,
        stack: new Error(err).stack,
      };
    }

    if (err && typeof err === "object") {
      return {
        name: err.name || err.code || "Error",
        message: err.message || err.reason || JSON.stringify(err),
        stack: err.stack || err.traceback || new Error(err.message).stack,
      };
    }

    return {
      name: "Error",
      message: "An unhandled execution trace slipped past standard boundaries.",
      stack: new Error().stack,
    };
  }

  /**
   * Comprehensive classification rules checking substring and classifications
   */
  private classifyError(error: any, context?: string): { errorType: string; severity: "low" | "medium" | "high" | "critical" } {
    const msg = String(error.message || error || "").toLowerCase();
    const name = String(error.name || "").toLowerCase();

    // 1. Storage Errors
    if (name.includes("quotaexceeded") || msg.includes("quota exceeded") || msg.includes("localstorage") || msg.includes("sessionstorage") || msg.includes("indexeddb")) {
      return { errorType: "localStorage quota exceeded", severity: "medium" };
    }

    // 2. React/Next.js/Vue Hydration Mismatches & Hook Violations
    if (msg.includes("hydration") || msg.includes("does not match server") || msg.includes("text content did not match")) {
      return { errorType: "React hydration error", severity: "high" };
    }
    if (msg.includes("invalid hook call") || msg.includes("rules of hooks")) {
      return { errorType: "Invalid hook call error", severity: "critical" };
    }
    if (msg.includes("failed prop type") || msg.includes("invalid prop")) {
      return { errorType: "Props type error", severity: "low" };
    }
    if (msg.includes("render") || msg.includes("react error boundary") || msg.includes("component render")) {
      return { errorType: "Component render error", severity: "critical" };
    }
    if (msg.includes("route not found") || msg.includes("cannot find route") || msg.includes("404 route")) {
      return { errorType: "Route not found error", severity: "medium" };
    }
    if (msg.includes("failed to fetch dynamically imported") || msg.includes("dynamic import")) {
      return { errorType: "Dynamic import error", severity: "high" };
    }
    if (msg.includes("suspense") || msg.includes("fallback")) {
      return { errorType: "Suspense boundary error", severity: "medium" };
    }

    // 3. Engine standard throws
    if (name === "typeerror" || msg.startsWith("typeerror")) {
      return { errorType: "TypeError", severity: "high" };
    }
    if (name === "referenceerror" || msg.startsWith("referenceerror")) {
      return { errorType: "ReferenceError", severity: "critical" };
    }
    if (name === "rangeerror" || msg.startsWith("rangeerror")) {
      if (msg.includes("maximum call stack") || msg.includes("stack overflow")) {
        return { errorType: "Stack overflow error", severity: "critical" };
      }
      return { errorType: "RangeError", severity: "high" };
    }
    if (name === "syntaxerror" || msg.startsWith("syntaxerror")) {
      return { errorType: "SyntaxError", severity: "high" };
    }
    if (name === "evalerror") {
      return { errorType: "EvalError", severity: "medium" };
    }
    if (name === "urierror") {
      return { errorType: "URIError", severity: "medium" };
    }

    // 4. Payment & Billing Errors (Stripe/Paypal)
    if (msg.includes("stripe") && (msg.includes("key") || msg.includes("init") || msg.includes("key is required") || msg.includes("is not defined"))) {
      return { errorType: "Stripe initialization error", severity: "critical" };
    }
    if (msg.includes("stripe") && (msg.includes("payment") || msg.includes("processing") || msg.includes("charge"))) {
      return { errorType: "Payment processing error", severity: "critical" };
    }
    if (msg.includes("card declined") || msg.includes("card_declined") || msg.includes("declined")) {
      return { errorType: "Card declined error", severity: "high" };
    }
    if (msg.includes("checkout session") || msg.includes("create checkout")) {
      return { errorType: "Checkout session error", severity: "high" };
    }
    if (msg.includes("refund failed") || msg.includes("refund_failed")) {
      return { errorType: "Refund failed error", severity: "high" };
    }

    // 5. Database Errors (Supabase / PG / Mongo)
    if (msg.includes("supabase query") || msg.includes("postgresterror")) {
      return { errorType: "Supabase query error", severity: "critical" };
    }
    if (msg.includes("unique constraint") || msg.includes("duplicate key")) {
      return { errorType: "Unique constraint error", severity: "high" };
    }
    if (msg.includes("foreign key")) {
      return { errorType: "Foreign key error", severity: "high" };
    }
    if (msg.includes("transaction failed") || msg.includes("rollback")) {
      return { errorType: "Transaction failed error", severity: "critical" };
    }
    if (msg.includes("connection lost") || msg.includes("db connection") || msg.includes("connection refused") || msg.includes("econnrefused")) {
      return { errorType: "Connection lost error", severity: "critical" };
    }
    if (msg.includes("query timeout") || msg.includes("statement timeout")) {
      return { errorType: "Query timeout error", severity: "high" };
    }

    // 6. JWT & Auth Server Errors
    if (msg.includes("jwt expired") || msg.includes("token expired") || msg.includes("jsonwebtokenexpired")) {
      return { errorType: "JWT expired error", severity: "high" };
    }
    if (msg.includes("jwt verification") || msg.includes("invalid signature") || msg.includes("jwt malformed")) {
      return { errorType: "JWT verification error", severity: "high" };
    }
    if (msg.includes("firebase-admin") || msg.includes("firebase admin")) {
      return { errorType: "Firebase admin error", severity: "critical" };
    }
    if (msg.includes("session creation") || msg.includes("create session")) {
      return { errorType: "Session creation error", severity: "high" };
    }
    if (msg.includes("password hash") || msg.includes("bcrypt") || msg.includes("argon2")) {
      return { errorType: "Password hash error", severity: "critical" };
    }

    // 7. General Client Authentication Errors
    if (msg.includes("auth/id-token-expired") || msg.includes("id token expired")) {
      return { errorType: "Token expired error", severity: "high" };
    }
    if (msg.includes("invalid-credential") || msg.includes("auth/invalid-credential") || msg.includes("invalid token")) {
      return { errorType: "Invalid token error", severity: "high" };
    }
    if (msg.includes("session ended") || msg.includes("session expired")) {
      return { errorType: "Session ended error", severity: "medium" };
    }
    if (msg.includes("oauth callback") || msg.includes("oauth error")) {
      return { errorType: "OAuth callback error", severity: "high" };
    }
    if (msg.includes("login failed") || msg.includes("invalid credentials")) {
      return { errorType: "Login failed error", severity: "medium" };
    }
    if (msg.includes("unauthorized") || msg.includes("permission denied") || msg.includes("forbidden") || msg.includes("unauthorized access") || msg.includes("permission_denied")) {
      return { errorType: "Unauthorized access error", severity: "high" };
    }

    // 8. Background & Queue
    if (msg.includes("cron job") || msg.includes("cron_failed") || msg.includes("cron failed")) {
      return { errorType: "Cron job failed", severity: "high" };
    }
    if (msg.includes("queue processing") || msg.includes("bullmq") || msg.includes("redis queue") || msg.includes("celery error")) {
      return { errorType: "Queue processing error", severity: "high" };
    }
    if (msg.includes("webhook delivery") || msg.includes("webhook_failed") || msg.includes("webhook failed")) {
      return { errorType: "Webhook delivery failed", severity: "high" };
    }
    if (msg.includes("retry limit exceeded") || msg.includes("max retries")) {
      return { errorType: "Retry limit exceeded", severity: "high" };
    }

    // 9. Node Errors (Server backend context)
    if (msg.includes("out of memory") || msg.includes("oom") || msg.includes("heap limit") || msg.includes("heap out of memory")) {
      return { errorType: "Out of memory error", severity: "critical" };
    }
    if (msg.includes("cannot find module") || msg.includes("module_not_found") || msg.includes("module not found")) {
      return { errorType: "Module not found error", severity: "critical" };
    }
    if (msg.includes("process crash") || msg.includes("sigterm") || msg.includes("sigint") || msg.includes("process.exit")) {
      return { errorType: "Process crash error", severity: "critical" };
    }

    // 10. Express Server Specifics
    if (context === "express" || msg.includes("route handler") || msg.includes("api router")) {
      return { errorType: "Route handler error", severity: "high" };
    }
    if (msg.includes("middleware")) {
      return { errorType: "Middleware error", severity: "high" };
    }
    if (msg.includes("validation error") || msg.includes("zoderror") || msg.includes("joi validation")) {
      return { errorType: "Request validation error", severity: "medium" };
    }
    if (msg.includes("body parser") || msg.includes("multer") || msg.includes("multipart") || msg.includes("body-parser")) {
      return { errorType: "Body parser error", severity: "high" };
    }
    if (msg.includes("too many requests") || msg.includes("rate limit") || msg.includes("429")) {
      return { errorType: "Rate limit error", severity: "high" };
    }

    // 11. Files, Uploads, CDNs
    if (msg.includes("file upload") || msg.includes("upload failed") || msg.includes("cloudinary") || msg.includes("s3 upload") || msg.includes("multipart upload")) {
      return { errorType: "File upload failed", severity: "high" };
    }
    if (msg.includes("file size exceeded") || msg.includes("payload too large") || msg.includes("size validation")) {
      return { errorType: "File size exceeded", severity: "medium" };
    }
    if (msg.includes("invalid file type") || msg.includes("mime type mismatch") || msg.includes("file format")) {
      return { errorType: "Invalid file type", severity: "medium" };
    }
    if (msg.includes("storage quota exceeded") || msg.includes("bucket quota") || msg.includes("exhausted quota")) {
      return { errorType: "Storage quota exceeded", severity: "high" };
    }
    if (msg.includes("cdn ") || msg.includes("upload to cdn") || msg.includes("cdn distribution")) {
      return { errorType: "CDN upload failed", severity: "high" };
    }

    // 12. Email System failures
    if (msg.includes("email sending failed") || msg.includes("sendgrid") || msg.includes("nodemailer") || msg.includes("resend")) {
      return { errorType: "Email sending failed", severity: "high" };
    }
    if (msg.includes("smtp connection") || msg.includes("smtp error") || msg.includes("mail connection")) {
      return { errorType: "SMTP connection error", severity: "high" };
    }
    if (msg.includes("template rendering") || msg.includes("mjml") || msg.includes("pug render")) {
      return { errorType: "Template rendering error", severity: "medium" };
    }
    if (msg.includes("onesignal") || msg.includes("push notification") || msg.includes("fcm payload")) {
      return { errorType: "OneSignal API error", severity: "high" };
    }

    // 13. Networking / API / CORS
    if (msg.includes("cors") || msg.includes("cross-origin") || msg.includes("preflight") || msg.includes("access-control-allow")) {
      return { errorType: "CORS error", severity: "high" };
    }
    if (msg.includes("fetch failed") || msg.includes("failed to fetch")) {
      return { errorType: "Fetch failed error", severity: "high" };
    }
    if (msg.includes("timeout") || msg.includes("aborted") || msg.includes("timed out") || msg.includes("etimedout")) {
      return { errorType: "Request timeout error", severity: "medium" };
    }
    if (msg.includes("websocket connection") || msg.includes("ws connection failed") || msg.includes("ws://") || msg.includes("wss://")) {
      return { errorType: "WebSocket connection error", severity: "high" };
    }
    if (msg.includes("websocket closed") || msg.includes("websocket disconnected") || msg.includes("ws.close")) {
      return { errorType: "WebSocket disconnect error", severity: "medium" };
    }

    // 14. Standard Promise Failures
    if (context === "unhandledrejection") {
      return { errorType: "Unhandled promise rejection", severity: "medium" };
    }
    if (msg.includes("async") && msg.includes("await")) {
      return { errorType: "Async await failure", severity: "high" };
    }
    if (msg.includes("promise chain") || msg.includes("promise.all") || msg.includes("promise.race")) {
      return { errorType: "Promise chain error", severity: "high" };
    }
    if (msg.includes("promise timed out") || msg.includes("promise timeout")) {
      return { errorType: "Promise timeout error", severity: "medium" };
    }

    // Fallbacks
    if (context === "uncaughtexception") {
      return { errorType: "Uncaught exception", severity: "high" };
    }

    return { errorType: "Uncaught exception", severity: "medium" };
  }
}

export const Reportli = new ReportliTracker();
export default Reportli;

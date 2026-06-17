# Reportli SDK 🚀

The official, enterprise-grade real-time exception tracking and AI-powered diagnostics SDK for client-side (SPA/Next.js/React/Vue), server-side (Node.js/Express), and full-stack software applications.

---

## Key Features

- **🛡️ 50+ Classified Errors**: Automatically groups and parses crashes including Standard exceptions, React Hydration errors, Invalid Hooks, Stripe Payment failures, database anomalies, CORS issues, Token expirations, and express timeouts.
- **🌐 Network Hooking**: Transparently intercept Global `fetch` and standard `XMLHttpRequest` transactions to capture API deviations (e.g. 400 Bad Requests, 401 Unauthorized, 404 Not Founds, and 500 Server Crashes).
- **📂 Resource Validation**: Captures failing third-party style asset downloads, un-resolving JS scripts, font timeouts, and image load errors.
- **⚡ Async/Rejections Safe**: Hooks deep into the browser thread (`unhandledrejection`) and Node processes (`unhandledRejection`, `uncaughtException`) to record issues before threads exit.
- **📢 Instant Setup Webhook**: Sells registration success notifications to your telemetry database instantly upon first module configuration.

---

## Installation

Install the package via standard node package managers:

```bash
npm install reportli
```

---

## Usage Guide

### 1. Browser/Single-Page Applications & React/Next.js Client (HTML/JS)

Simply import and run the initialization at the main entry file (`src/index.tsx`, `app/layout.tsx` or raw `App.js` blocks):

```typescript
import { Reportli } from 'reportli';

Reportli.init({
  apiKey: "YOUR_PROJECT_API_KEY",
  projectName: "My Customer Portal UI",
  projectId: "portal-ui",
  environment: "production",
  userEmail: "client-agent@domain.com"
});
```

### 2. Node.js & Express Backends (Server-Side)

Reportli hooks into your routes to catch server-side crashes and express execution exceptions.

```javascript
const express = require('express');
const { Reportli } = require('reportli');

const app = express();

// Initialize the Exception agent
Reportli.init({
  apiKey: "YOUR_PROJECT_API_KEY",
  projectName: "Billing & Subscriptions API",
  projectId: "billing-api",
  framework: "Express"
});

app.use(express.json());

// ... Standard route handlers ...
app.get("/api/checkout", (req, res) => {
  throw new Error("Stripe payment processing failed: Card declined"); // Auto-caught & classified!
});

// Place Reportli Error Handler at the ultimate end of active middleware
app.use(Reportli.expressErrorHandler);

app.listen(3000);
```

### 3. Manual Crash Tracking & Custom Severity

Report custom exception payloads with forced severity tiers:

```typescript
try {
  initiateComplexDbSync();
} catch (error) {
  // Capture manually
  Reportli.captureException(error, "critical");
}
```

---

## Publishing to npmjs.com

Follow these three simple commands to compile, bundle, and release the SDK:

1. **Install Build Dependencies**:
   ```bash
   cd reportli-sdk
   npm install
   ```

2. **Bundle/Build Package**:
   ```bash
   npm run build
   ```
   This generates ESM (`dist/index.mjs`), CommonJS (`dist/index.js`), and fully mapped TS definitions (`dist/index.d.ts`).

3. **Publish to Registry**:
   ```bash
   npm publish --access public
   ```

---

## License

This project is licensed under the [MIT License](LICENSE).

const Reportli = require("reportli");

// ─────────────────────────────────────────────
// 1. Initialize Reportli
// ─────────────────────────────────────────────

Reportli.init({
  apiKey: "test",
  environment: "test",
});

console.log("✅ Reportli SDK initialized");

// ─────────────────────────────────────────────
// 2. Identify a test user
// ─────────────────────────────────────────────

Reportli.identify({
  userId: "test-user-001",
  email: "testuser@example.com",
  name: "Test User",
});

console.log("✅ Test user identified");

// ─────────────────────────────────────────────
// 3. Track user activity
// ─────────────────────────────────────────────

Reportli.track("login");

Reportli.track("page_view", {
  page: "/dashboard",
});

Reportli.track("button_clicked", {
  button: "Create Report",
});

Reportli.track("search", {
  query: "monthly revenue",
});

Reportli.track("checkout_started", {
  plan: "Premium",
});

console.log("✅ User activities tracked");

// ─────────────────────────────────────────────
// 4. Send a test error
// ─────────────────────────────────────────────

try {
  throw new Error("TEST: Database connection failed");
} catch (error) {
  Reportli.capture(error);
}

console.log("✅ Test error captured");

// ─────────────────────────────────────────────
// 5. Send another test error
// ─────────────────────────────────────────────

Reportli.captureMessage(
  "TEST: Payment button stopped working"
);

console.log("✅ Test message captured");

// ─────────────────────────────────────────────
// 6. Wait and send session
// ─────────────────────────────────────────────

setTimeout(() => {
  console.log("📤 Flushing session activity...");

  Reportli.flushSession();

  console.log("✅ Test completed");
}, 3000);

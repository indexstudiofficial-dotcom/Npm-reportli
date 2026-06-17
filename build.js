const esbuild = require("esbuild");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

async function build() {
  console.log("🧹 Cleaning dist folder...");
  const distPath = path.join(__dirname, "dist");
  if (fs.existsSync(distPath)) {
    fs.rmSync(distPath, { recursive: true, force: true });
  }

  console.log("📦 Compiling CommonJS bundle...");
  await esbuild.build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.js",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2020",
    sourcemap: true,
    minify: false,
    external: ["esbuild"],
  });

  console.log("📦 Compiling ES Module bundle...");
  await esbuild.build({
    entryPoints: ["src/index.ts"],
    outfile: "dist/index.mjs",
    bundle: true,
    platform: "neutral",
    format: "esm",
    target: "es2020",
    sourcemap: true,
    minify: false,
  });

  console.log("🏷️  Generating TypeScript declaration files...");
  try {
    execSync("npx tsc --emitDeclarationOnly --outDir dist", { cwd: __dirname });
    console.log("✨ TypeScript declarations generated successfully.");
  } catch (error) {
    console.error("⚠️ Failed to generate TypeScript declaration files. Proceeding anyway...", error);
  }

  console.log("🚀 Reportli SDK build completed successfully!");
}

build().catch((err) => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});

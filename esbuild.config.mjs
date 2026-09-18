import esbuild from "esbuild";
import { resolve } from "path";
import { copyFileSync } from "fs";

const args = process.argv.slice(2);
const prod = args.includes("production");
const sandbox = args.includes("sandbox");
const once = prod || args.includes("once");

// Dev: output to vault plugin dir for hot reload
// Production: output to repo root for release
// Sandbox: output to the demo vault (watch by default, "once" for a single build)
const outDir = prod
  ? resolve(".")
  : sandbox
  ? resolve("E:/Projects/sonnet-agent/Vault-DemoSandbox/.obsidian/plugins/neighbourhood-graph")
  : resolve("E:/Projects/sonnet-agent/Vault101/.obsidian/plugins/neighbourhood-graph");

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/*",
    "@lezer/*",
    "@codemirror/state",
    "@codemirror/view",
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: `${outDir}/main.js`,
});

if (!prod) {
  // Copy manifest and styles to vault plugin dir for Obsidian to detect
  copyFileSync(resolve("manifest.json"), `${outDir}/manifest.json`);
  copyFileSync(resolve("styles.css"), `${outDir}/styles.css`);
}

if (once) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}

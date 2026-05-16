import esbuild from "esbuild";
import { resolve } from "path";
import { copyFileSync } from "fs";

const prod = process.argv[2] === "production";

// Dev: output to vault plugin dir for hot reload
// Production: output to repo root for release
const outDir = prod
  ? resolve(".")
  : resolve(
      "E:/Projects/sonnet-agent/Vault101/.obsidian/plugins/neighbourhood-graph"
    );

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

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  // Copy manifest and styles to vault plugin dir for Obsidian to detect
  copyFileSync(resolve("manifest.json"), `${outDir}/manifest.json`);
  copyFileSync(resolve("styles.css"), `${outDir}/styles.css`);
  await ctx.watch();
}

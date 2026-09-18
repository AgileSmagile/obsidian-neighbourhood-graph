// Regenerates docs/screenshot-*.png from the demo sandbox vault.
//
// Obsidian is Electron, so it can be launched with a remote debugging port and
// driven over the Chrome DevTools Protocol. No plugin changes are needed.
//
// Usage: npm run screenshots
//
// What it does:
//   1. closes any running Obsidian (Electron holds a single-instance lock)
//   2. launches Obsidian on the demo vault with --remote-debugging-port
//   3. drives the workspace: opens the focus note, opens the panel, toggles
//      settings, hovers a node
//   4. clips each screenshot to the sidebar leaf and writes it to docs/
//   5. quits Obsidian and relaunches it normally if it was running before

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const OBSIDIAN = process.env.OBSIDIAN_EXE ?? "C:\\Program Files\\Obsidian\\Obsidian.exe";
const VAULT = "Vault-DemoSandbox";
const PORT = 9222;
const OUT = resolve("docs");
const SIDEBAR_WIDTH = 600;

// Focus notes chosen from the demo vault to show each feature off.
const SHOTS = [
	{ file: "screenshot-main.png", note: "Hubs/Content Hub.md", settings: false },
	{ file: "screenshot-highlight.png", note: "Hubs/Content Hub.md", settings: false, hover: "Home" },
	{ file: "screenshot-typed-edges.png", note: "Philosophy/Existentialism.md", settings: false },
	{ file: "screenshot-import.png", note: "Hubs/Content Hub.md", settings: true },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function obsidianRunning() {
	try {
		const out = execSync('tasklist /FI "IMAGENAME eq Obsidian.exe" /NH', { encoding: "utf8" });
		return out.includes("Obsidian.exe");
	} catch {
		return false;
	}
}

function killObsidian() {
	try { execSync("taskkill /IM Obsidian.exe /F", { stdio: "ignore" }); } catch { /* not running */ }
}

async function connect() {
	for (let i = 0; i < 40; i++) {
		try {
			return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
		} catch {
			await sleep(500);
		}
	}
	throw new Error("Could not connect to Obsidian over CDP");
}

async function main() {
	if (!existsSync(OBSIDIAN)) throw new Error(`Obsidian not found at ${OBSIDIAN}. Set OBSIDIAN_EXE.`);
	mkdirSync(OUT, { recursive: true });

	const wasRunning = obsidianRunning();
	if (wasRunning) {
		console.warn("Closing the running Obsidian instance for the capture. It will be relaunched afterwards.");
		killObsidian();
		await sleep(2000);
	}

	spawn(OBSIDIAN, [`--remote-debugging-port=${PORT}`, `obsidian://open?vault=${VAULT}`], {
		detached: true,
		stdio: "ignore",
	}).unref();

	const browser = await connect();
	let page;
	for (let i = 0; i < 40 && !page; i++) {
		page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith("app://obsidian.md"));
		if (!page) await sleep(500);
	}
	if (!page) throw new Error("Obsidian window not found");

	// Wait for the workspace, then make sure the plugin's view is the only thing in the right sidebar.
	await page.waitForFunction(() => window.app?.workspace?.layoutReady === true, null, { timeout: 60000 });
	await page.evaluate(async ({ width, viewType }) => {
		window.require("electron").remote.getCurrentWindow().setSize(1400, 820);
		const app = window.app;
		const ws = app.workspace;
		// Dark theme, no status bar, and a fuller neighbourhood than the sandbox default.
		app.changeTheme("obsidian");
		document.querySelector(".status-bar")?.setCssStyles({ display: "none" });
		const plugin = app.plugins.plugins[viewType];
		Object.assign(plugin.settings, { maxNeighbours: 16, depth: 2, maxNodeSize: 14, salienceImpact: 6, spread: 8 });
		await plugin.saveSettings();
		// Start from a clean sidebar: drop any stale copies of the view and every other right-sidebar tab.
		ws.getLeavesOfType(viewType).forEach((l) => l.detach());
		ws.iterateAllLeaves((l) => { if (l.getRoot() === ws.rightSplit) l.detach(); });
		ws.leftSplit.collapse();
		const leaf = ws.getRightLeaf(false);
		await leaf.setViewState({ type: viewType, active: false });
		ws.rightSplit.expand();
		ws.rightSplit.setSize(width);
		ws.revealLeaf(leaf);
	}, { width: SIDEBAR_WIDTH, viewType: "neighbourhood-graph" });
	await sleep(1500);

	const leaf = page.locator(".workspace-leaf:has(.neighbourhood-graph-container)").first();

	for (const shot of SHOTS) {
		await page.evaluate(async (path) => {
			const file = window.app.vault.getAbstractFileByPath(path);
			const ws = window.app.workspace;
			await ws.getLeaf(false).openFile(file);
			ws.revealLeaf(ws.getLeavesOfType("neighbourhood-graph")[0]);
		}, shot.note);
		// Let the simulation settle before capturing.
		await page.waitForFunction(
			() => document.querySelectorAll(".neighbourhood-graph-svg > g > g:last-child > g").length > 3,
			null, { timeout: 15000 },
		);
		await sleep(3500);

		const panelHidden = await leaf.locator(".ng-settings-panel").evaluate((el) => el.classList.contains("ng-panel-hidden"));
		if (panelHidden === shot.settings) await leaf.locator(".ng-control-btn").first().click();

		if (shot.hover) {
			// Hover by label: find the node group whose text matches and aim at its circle.
			const box = await page.evaluate((label) => {
				const groups = [...document.querySelectorAll(".neighbourhood-graph-svg > g > g:last-child > g")];
				const target = groups.find((g) => g.textContent.trim().startsWith(label));
				if (!target) return null;
				const r = target.querySelector("circle").getBoundingClientRect();
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
			}, shot.hover);
			if (!box) throw new Error(`No node labelled "${shot.hover}" in the graph`);
			await page.mouse.move(box.x, box.y);
			await sleep(600);
		} else {
			await page.mouse.move(0, 0);
		}

		await leaf.screenshot({ path: resolve(OUT, shot.file) });
		console.warn(`wrote docs/${shot.file}`);
	}

	await browser.close();
	// NG_KEEP=1 leaves the debug instance running so the DOM can be inspected over CDP.
	if (process.env.NG_KEEP) return;
	killObsidian();
	if (wasRunning) {
		await sleep(1000);
		spawn(OBSIDIAN, [], { detached: true, stdio: "ignore" }).unref();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

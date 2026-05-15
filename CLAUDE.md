# Neighbourhood Graph — Project Instructions

## What this is

An Obsidian community plugin that shows the current note's neighbourhood as an interactive D3.js force-directed graph in a sidebar panel. Ported from the smagile.co blog neighbourhood graph, adapted for Obsidian's metadata model.

**Plugin ID:** `neighbourhood-graph`
**Author:** James Farley
**Target:** Community plugin directory from the start
**Scope doc:** `E:\Projects\sonnet-agent\Vault101\Partnerships\MilUX\neighbourhood-graph-scope.md`

## AUTONOMY RULE (non-negotiable)

Do not ask James for permission to start work, move cards, or choose between implementation options. Declare your intent and execute. The only valid reasons to pause: (1) product decisions that cannot be inferred from docs, (2) irreversible actions on production, (3) architectural choices with cross-project consequences. Full details in `agent_guidelines.md` under "DO NOT ASK PERMISSION FOR ROUTINE WORK". Banned phrases: "Should I...", "Would you like me to...", "Ready when you are", "Let me know if...".

## Agent operating model

Follow `E:\Projects\sonnet-agent\agent_guidelines.md` for board workflow and autonomy. Cards live on CapDev board (board 4), lane 6. Use prefix `[NG]` for card titles and comments.

Key commands (run from `E:\Projects\sonnet-agent`):

```bash
bash bin/bmap card <id>
bash bin/bmap wip-age
bash bin/bmap move <id> <col>
bash bin/bmap comment <id> "text"
```

## Session startup routine (mandatory, every session)

1. Read this file and `E:\Projects\sonnet-agent\agent_guidelines.md`
2. Read the scope doc: `E:\Projects\sonnet-agent\Vault101\Partnerships\MilUX\neighbourhood-graph-scope.md`
3. Check domain knowledge: `E:\Projects\sonnet-agent\knowledge\capdev\knowledge.md` (contains Obsidian plugin submission process)
4. `bash E:\Projects\sonnet-agent\bin\bmap wip-age`
5. Determine focus: `[NG]` cards in Doing, Ready cards tagged to neighbourhood graph
6. **Declare intent and start**

## Technical stack

- **Language:** TypeScript
- **Rendering:** D3.js (force-directed graph)
- **Data source:** Obsidian `MetadataCache` for resolved links, tags, and frontmatter
- **Plugin API:** Obsidian `Plugin`, `ItemView`, `PluginSettingTab`
- **Build tool:** esbuild (standard for Obsidian plugins)
- **Output:** `main.js`, `manifest.json`, `styles.css` in the repo root

## Lessons from graph-label-fix (sibling plugin)

The `obsidian-graph-label-fix` repo at `E:\Projects\obsidian-graph-label-fix\` was James's first Obsidian plugin. Key lessons:

### Build and dev workflow
- esbuild config outputs to vault plugin dir for dev (`Vault101/.obsidian/plugins/<plugin-id>/main.js`), NOT repo root
- For releases: copy `main.js` to repo root, then `gh release create`
- Dev mode: `npm run dev` watches and rebuilds into vault plugin dir
- Production: `npm run build` creates optimised bundle

### Obsidian API patterns
- Monkey-patching prototype methods is how you extend internal renderers (graph-label-fix patches `render()`)
- `onLayoutReady`, `layout-change`, and `active-leaf-change` are the key workspace events
- `registerEvent()` handles cleanup on unload automatically
- Settings: `loadData()`/`saveData()` for persistence, `PluginSettingTab` for UI
- Always store original methods before patching and restore in `onunload()`

### Community plugin submission (May 2026)
- Portal at community.obsidian.md (NOT GitHub PRs on obsidianmd/obsidian-releases)
- Portal scans against latest **tagged release**, not main branch
- Linter rules: no `any` types, no `console.log` (use debug/warn/error), no `this` aliasing, no plugin name in settings headings, no `element.style.cssText` (use `el.setCssStyles()`), `eslint-disable` needs descriptions, sentence case in UI text
- Install `@obsidian-plugins/eslint-plugin` locally for pre-flight checks
- Release: bump `manifest.json` + `versions.json`, build, copy `main.js` to root, `gh release create vX.Y.Z --title "vX.Y.Z" main.js manifest.json`

### What NOT to do
- Don't use `console.log` — community portal rejects it. Use `console.debug` for dev
- Don't use `const plugin = this` — triggers `no-this-alias`. Use arrow closures: `const getSettings = () => this.settings`
- Don't use `element.style.cssText` — use Obsidian's `el.setCssStyles({ ... })`

## Source code to port

The smagile.co website has a working neighbourhood graph. Key files to reference:

| Website file | Plugin equivalent | Notes |
|-------------|-------------------|-------|
| `blog-graph-data.ts` | `src/graph-data.ts` | Algorithm ports; data source changes to MetadataCache |
| `BlogGraphNeighbourhood.astro` (D3 section) | `src/graph-renderer.ts` | Force setup, interactions port near-verbatim |
| `blog-graph-data.test.ts` | Tests | Mock MetadataCache instead of Astro collections |

Website source: `E:\Projects\smagilewebsite-v2\src\`

## Writing standards

- British English throughout
- Never use em dashes
- Sentence case in all UI text (Obsidian convention and linter requirement)

## Merge authority

- **Tier 1 (merge autonomously)**: CI green, diff under 200 lines, no UI/UX changes
- **Tier 2 (request approval)**: UI/UX decisions, new features, settings changes
- **Tier 3 (product review)**: Community submission, README content, public-facing copy

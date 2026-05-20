# Neighbourhood Graph

An Obsidian plugin that shows the current note's neighbourhood as an interactive force-directed graph in a sidebar panel. Navigate your vault by exploring connections between notes, shared tags, and backlinks.

> Screenshots will be added in a future update.

## What it does

Opens as a right-sidebar panel. As you navigate between notes, the graph recentres on the active note and shows:

- **The focus note** highlighted with an amber glow, largest node
- **Neighbour notes** connected via shared tags or backlinks, sized by relevance
- **Shared tag nodes** (diamond shapes) representing tags that connect notes
- **Typed edges** — when Excalibrain is installed, edges between related notes are drawn with distinct line styles

Hover any node to highlight its connections. At depth 2, secondary connections also light up, revealing the structure around any note in the neighbourhood.

### Interactions

| Action | Behaviour |
|--------|-----------|
| Hover node | Highlights direct connections (and secondary connections at depth 2) |
| Hover edge | Shows the relationship type if the edge is a typed Excalibrain relationship |
| Click | Recentres the graph on that note |
| Double-click | Opens the note in the editor and recentres |
| Drag | Repositions a node |
| Scroll | Zoom in and out |

## Installation

### From the community plugin directory

1. Settings > Community plugins > Browse
2. Search "Neighbourhood Graph"
3. Install and enable

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/AgileSmagile/obsidian-neighbourhood-graph/releases/latest)
2. Create a folder at `<your vault>/.obsidian/plugins/neighbourhood-graph/`
3. Copy all three files into that folder
4. Settings > Community plugins > reload and enable **Neighbourhood Graph**

## Settings

There are two places to configure the plugin:

### Floating panel (gear icon on the graph)

Quick access to the controls you reach for most often.

| Setting | Description | Default |
|---------|-------------|---------|
| Highlight depth | Tiers of connections highlighted on hover. 1 = direct only. 2 = direct + secondary. | 2 hops |
| Max neighbours | Cap on displayed notes. Most strongly connected shown first. | 30 |
| Size by relevance | How much node size varies by connection strength. 0 = uniform, 10 = dramatic. | 5 |
| Max node size | Maximum radius in pixels of the largest neighbour node. Reduce for a compact sidebar. | 10 |

**Physics sliders** — four controls for fine-tuning the graph layout: line colour, line thickness, spread (repulsion), and link pull (clustering). Changes are reflected live as you drag without rebuilding the graph.

### Plugin settings tab (Settings > Neighbourhood Graph)

| Setting | Description | Default |
|---------|-------------|---------|
| Highlight depth | Same as the floating panel. | 2 hops |
| Max neighbours | Same as the floating panel. | 30 |
| Max node size | Maximum node radius. Reduce for compact sidebars; increase for full-panel views. | 10 |
| Show path in tooltip | Display the vault-relative folder path when hovering a note node. | On |
| Default node colour | Colour used for notes not matching any colour group. Falls back to your theme's accent colour. | Theme accent |

### Colour groups

Assign colours to notes by query. Three query types are supported:

- `path:people/` — matches notes whose path starts with `people/`
- `tag:#project` — matches notes carrying the `#project` tag
- Plain text — matches against note title

First matching rule wins. Groups are collapsible in the settings tab once at least one exists. Use the **Import** button to copy colour groups directly from Obsidian's built-in graph view.

## Excalibrain integration

If [Excalibrain](https://obsidian.md/plugins?id=excalibrain) is installed, this plugin reads its typed relationship fields from note frontmatter to draw distinct edge styles and weight connections more accurately.

| Relationship | Edge style | Default frontmatter fields |
|---|---|---|
| Parent / child | Solid line | `Parent`, `Parents`, `Children`, `Child`, `up`, `down` |
| Friend | Dashed line | `Friends`, `Friend`, `similar`, `supports`, `alternatives` |
| Opposes | Dotted line | `opposes`, `disadvantages`, `cons` |
| Previous / next | Dash-dot line | `Previous`, `Next`, `Before`, `After` |

The plugin detects three states:

- **Not installed** — plain edges only; the settings tab explains how to get Excalibrain
- **Installed, not yet opened** — uses Excalibrain's built-in English field names
- **Installed and configured** — reads your saved Excalibrain settings automatically

Toggle the integration on or off with the **Use Excalibrain relationships** toggle in the settings tab. When active, typed links receive a strength bonus so they rank higher in the neighbourhood.

Hover any typed edge to see the relationship label ("parent of", "friend", "opposes", etc.) in a tooltip.

The legend in the top-left of the graph panel shows edge style swatches that reflect your current line colour and thickness settings, so the key always matches the graph.

## How it works

The plugin reads Obsidian's metadata cache for tags, resolved links, and frontmatter links. No custom frontmatter is required for basic use. Neighbours are scored by connection strength:

- Shared tags between the focus note and a neighbour
- Direct wikilinks (outbound and inbound)
- Bidirectional links score higher
- Well-connected hub notes rank higher (logarithmic scaling)
- Excalibrain-typed relationships receive an additional strength bonus

The top N neighbours (configurable) are shown. Node size reflects relevance to the focus note — salience scaling is anchored to the displayed set, so variation fills the full range regardless of how many notes are capped.

## Works well with

**[Graph Label Above](https://github.com/AgileSmagile/obsidian-graph-label-above)** — moves node labels above nodes in Obsidian's full graph view so they are not obscured by an enlarged mouse pointer. If you use Neighbourhood Graph alongside the built-in graph view, this is a natural companion.

## Licence

MIT

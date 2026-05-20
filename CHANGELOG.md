# Changelog

## 0.2.0 — 2026-05-20

### Added

- **Excalibrain integration** — when Excalibrain is installed, the plugin reads its typed relationship fields (`Parent`, `Children`, `Friends`, `opposes`, `Previous`, `Next`, and any custom fields from your Excalibrain config) to draw distinct edge styles: solid for parent/child, dashed for friend, dotted for opposes, dash-dot for previous/next. Typed links also receive a connection-strength bonus so they rank higher in the neighbourhood.
- **Three-state Excalibrain detection** — shows a status badge (installed and configured / installed but not yet opened / not installed) with tailored instructions in the settings tab. Falls back to Excalibrain's built-in English field names when the plugin is installed but has not been opened yet.
- **Edge hover tooltip** — hovering a typed edge shows the relationship label ("parent of", "child of", "friend", "opposes", etc.) in a tooltip.
- **Dynamic legend** — the edge-style key in the top-left legend now uses real SVG lines with the correct dash patterns, and updates live as you adjust the line colour and line thickness sliders. The key always matches the graph.
- **Max node size setting** — controls the maximum radius in pixels of the largest neighbour node. Available in both the floating panel and the plugin settings tab. Default 10, optimised for a narrow sidebar.
- **Collapsible colour groups** — the colour group list in the settings tab collapses by default once at least one group exists, keeping the settings page tidy. Expands automatically when you add a new group.

### Changed

- **Settings reorganisation** — the floating panel now covers the controls you reach for most often (highlight depth, max neighbours, display size, physics). Colour groups, tooltip options, and the Excalibrain section live in the plugin settings tab where there is more room.
- **Show path in tooltip** moved from the floating panel to the plugin settings tab.
- **Import colour groups button** — redesigned as a discrete icon-only button in the settings tab, with a text label and tooltip.
- **Primary highlight intensity reduced** — the glow, stroke weight, and opacity of directly highlighted edges have been reduced by ~20% to avoid overpowering the graph when a well-connected node is hovered.
- **Salience scaling anchored to displayed set** — node size variation is now computed relative to the notes actually shown, not all vault notes. This maximises visual differentiation regardless of how many notes are capped.
- **Slider persistence** — physics sliders (line colour, line thickness, spread, link pull) now persist on mouse-up without triggering a full graph rebuild, eliminating the jitter that occurred when dragging a slider.

## 0.1.0 — initial release

- Force-directed neighbourhood graph in a sidebar panel
- Neighbour scoring by shared tags, wikilinks, and bidirectional links
- Hover highlighting with configurable depth (1 or 2 hops)
- Draggable, collapsible legend
- Colour groups with path, tag, and title query types
- Import colour groups from Obsidian's built-in graph view
- Physics controls: line colour, line thickness, spread, link pull
- Click to recentre, double-click to open

import type { App, TFile } from 'obsidian';
import type { GraphData, GraphNode, GraphEdge, NeighbourhoodGraphSettings } from './types';

/**
 * Build a neighbourhood subgraph centred on the focus file.
 *
 * Always shows direct neighbours only (1-hop data). The depth setting
 * controls visual highlight tiers on hover, not which nodes appear.
 *
 * Neighbours are ranked by connection strength (shared tags + direct links)
 * and capped at maxNeighbours.
 */
export function buildNeighbourhood(
	focusFile: TFile,
	app: App,
	settings: NeighbourhoodGraphSettings,
): GraphData {
	const vault = app.vault;
	const allFiles = vault.getMarkdownFiles();

	const focusTags = getFileTags(focusFile, app);
	const focusOutLinks = getOutLinks(focusFile, app);
	const focusInLinks = getInLinks(focusFile, app);
	const focusAllLinks = new Set([...focusOutLinks, ...focusInLinks]);

	const nodeMap = new Map<string, GraphNode>();
	const edgeSet = new Set<string>();
	const edges: GraphEdge[] = [];

	// Add focus node
	nodeMap.set(focusFile.path, {
		id: focusFile.path,
		type: 'note',
		label: focusFile.basename,
		path: focusFile.parent?.path ?? '',
		focus: true,
		strength: 0,
	});

	// Build tag → notes index
	const tagToNotes = new Map<string, Set<string>>();
	for (const file of allFiles) {
		const tags = getFileTags(file, app);
		for (const tag of tags) {
			if (!tagToNotes.has(tag)) tagToNotes.set(tag, new Set());
			tagToNotes.get(tag)!.add(file.path);
		}
	}

	// Score each potential neighbour by connection strength.
	// Strength components:
	//   - Each shared tag: +1
	//   - Outlink from focus: +2
	//   - Inlink to focus (backlink): +2
	//   - Bidirectional link (both directions): +2 bonus
	//   - Neighbour's own link count (hub score): +log2(links)
	const neighbourStrength = new Map<string, number>();

	// Tag neighbours: notes sharing at least one tag
	const focusSharedTags = new Set<string>();
	for (const tag of focusTags) {
		const notesWithTag = tagToNotes.get(tag);
		if (notesWithTag && notesWithTag.size > 1) {
			focusSharedTags.add(tag);
			for (const notePath of notesWithTag) {
				if (notePath !== focusFile.path) {
					neighbourStrength.set(notePath, (neighbourStrength.get(notePath) ?? 0) + 1);
				}
			}
		}
	}

	// Link neighbours with directionality bonus
	for (const linkedPath of focusOutLinks) {
		neighbourStrength.set(linkedPath, (neighbourStrength.get(linkedPath) ?? 0) + 2);
	}
	for (const linkedPath of focusInLinks) {
		neighbourStrength.set(linkedPath, (neighbourStrength.get(linkedPath) ?? 0) + 2);
	}
	// Bidirectional bonus
	for (const linkedPath of focusOutLinks) {
		if (focusInLinks.has(linkedPath)) {
			neighbourStrength.set(linkedPath, (neighbourStrength.get(linkedPath) ?? 0) + 2);
		}
	}

	// Hub score: neighbours that are themselves well-connected rank higher
	for (const [notePath] of neighbourStrength) {
		const file = vault.getFileByPath(notePath);
		if (!file) continue;
		const outCount = Object.keys(app.metadataCache.resolvedLinks[notePath] ?? {}).length;
		const inCount = Object.values(app.metadataCache.resolvedLinks)
			.filter((targets) => targets[notePath]).length;
		const hubScore = Math.log2(Math.max(1, outCount + inCount));
		neighbourStrength.set(notePath, (neighbourStrength.get(notePath) ?? 0) + hubScore);
	}

	// Sort by strength (highest first) and cap
	const sorted = [...neighbourStrength.entries()]
		.sort((a, b) => b[1] - a[1]);
	const capped = sorted.slice(0, settings.maxNeighbours);
	const truncated = Math.max(0, sorted.length - settings.maxNeighbours);
	const neighbourSet = new Set(capped.map(([path]) => path));

	// Add neighbour note nodes
	for (const [notePath, strength] of capped) {
		const file = vault.getFileByPath(notePath);
		if (!file) continue;
		nodeMap.set(notePath, {
			id: notePath,
			type: 'note',
			label: file.basename,
			path: file.parent?.path ?? '',
			strength,
		});
	}

	// Add tag concept nodes and edges
	for (const tag of focusSharedTags) {
		const tagId = `tag:${tag}`;
		const notesWithTag = tagToNotes.get(tag)!;

		// Only add tag if at least one neighbour in the capped set has it
		let hasNeighbour = false;
		for (const notePath of neighbourSet) {
			if (notesWithTag.has(notePath)) {
				hasNeighbour = true;
				break;
			}
		}
		if (!hasNeighbour) continue;

		nodeMap.set(tagId, {
			id: tagId,
			type: 'tag',
			label: tag,
		});

		// Edge: focus → tag
		addEdge(focusFile.path, tagId);

		// Edges: neighbour → tag
		for (const notePath of neighbourSet) {
			if (notesWithTag.has(notePath)) {
				addEdge(notePath, tagId);
			}
		}
	}

	// Add direct link edges between focus and backlink neighbours
	for (const linkedPath of focusAllLinks) {
		if (neighbourSet.has(linkedPath)) {
			addEdge(focusFile.path, linkedPath);
		}
	}

	return {
		nodes: [...nodeMap.values()],
		edges,
		truncated: truncated > 0 ? truncated : undefined,
	};

	function addEdge(source: string, target: string): void {
		const key = `${source}\u2192${target}`;
		const reverseKey = `${target}\u2192${source}`;
		if (edgeSet.has(key) || edgeSet.has(reverseKey)) return;
		edgeSet.add(key);
		edges.push({ source, target });
	}
}

function getFileTags(file: TFile, app: App): Set<string> {
	const cache = app.metadataCache.getFileCache(file);
	const tags = new Set<string>();
	if (!cache) return tags;

	if (cache.tags) {
		for (const t of cache.tags) {
			tags.add(t.tag.toLowerCase());
		}
	}

	if (cache.frontmatter?.tags) {
		const fmTags = cache.frontmatter.tags;
		const tagArray = Array.isArray(fmTags) ? fmTags : [fmTags];
		for (const t of tagArray) {
			if (typeof t === 'string') {
				const normalised = t.startsWith('#') ? t.toLowerCase() : `#${t.toLowerCase()}`;
				tags.add(normalised);
			}
		}
	}

	return tags;
}

function getOutLinks(file: TFile, app: App): Set<string> {
	const links = new Set<string>();
	const resolved = app.metadataCache.resolvedLinks[file.path];
	if (resolved) {
		for (const target of Object.keys(resolved)) {
			links.add(target);
		}
	}
	return links;
}

function getInLinks(file: TFile, app: App): Set<string> {
	const links = new Set<string>();
	const allResolved = app.metadataCache.resolvedLinks;
	for (const [sourcePath, targets] of Object.entries(allResolved)) {
		if (sourcePath !== file.path && targets[file.path]) {
			links.add(sourcePath);
		}
	}
	return links;
}

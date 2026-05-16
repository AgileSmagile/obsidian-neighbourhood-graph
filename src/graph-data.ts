import type { App, TFile } from 'obsidian';
import type { GraphData, GraphNode, GraphEdge, NeighbourhoodGraphSettings } from './types';

/**
 * Build a neighbourhood subgraph centred on the focus file.
 *
 * Connections come from two sources:
 * 1. Tags: notes sharing at least one tag with the focus note
 * 2. Backlinks: notes linked to/from the focus note via wikilinks
 *
 * Depth 1: focus + direct neighbours + shared concepts
 * Depth 2: adds neighbours-of-neighbours and their connecting concepts
 */
export function buildNeighbourhood(
	focusFile: TFile,
	app: App,
	settings: NeighbourhoodGraphSettings,
): GraphData {
	const cache = app.metadataCache;
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
		hopLevel: 0,
	});

	// Find hop-1 neighbours
	const hop1Neighbours = new Set<string>();

	// Tag neighbours: notes sharing at least one tag
	const tagToNotes = new Map<string, Set<string>>();
	for (const file of allFiles) {
		const tags = getFileTags(file, app);
		for (const tag of tags) {
			if (!tagToNotes.has(tag)) tagToNotes.set(tag, new Set());
			tagToNotes.get(tag)!.add(file.path);
		}
	}

	const focusSharedTags = new Set<string>();
	for (const tag of focusTags) {
		const notesWithTag = tagToNotes.get(tag);
		if (notesWithTag && notesWithTag.size > 1) {
			focusSharedTags.add(tag);
			for (const notePath of notesWithTag) {
				if (notePath !== focusFile.path) {
					hop1Neighbours.add(notePath);
				}
			}
		}
	}

	// Backlink neighbours: notes linked to/from focus
	for (const linkedPath of focusAllLinks) {
		hop1Neighbours.add(linkedPath);
	}

	// Cap neighbours at maxNeighbours
	const hop1Array = [...hop1Neighbours].slice(0, settings.maxNeighbours);
	const hop1Set = new Set(hop1Array);
	const truncated = Math.max(0, hop1Neighbours.size - settings.maxNeighbours);

	// Add hop-1 note nodes
	for (const notePath of hop1Set) {
		const file = vault.getFileByPath(notePath);
		if (!file) continue;
		nodeMap.set(notePath, {
			id: notePath,
			type: 'note',
			label: file.basename,
			path: file.parent?.path ?? '',
			hopLevel: 1,
		});
	}

	// Add tag concept nodes and edges for hop-1
	for (const tag of focusSharedTags) {
		const tagId = `tag:${tag}`;
		if (!nodeMap.has(tagId)) {
			nodeMap.set(tagId, {
				id: tagId,
				type: 'tag',
				label: tag,
				hopLevel: 1,
			});
		}
		// Edge: focus → tag
		addEdge(focusFile.path, tagId);

		// Edges: neighbour → tag (only if neighbour has this tag)
		const notesWithTag = tagToNotes.get(tag)!;
		for (const notePath of hop1Set) {
			if (notesWithTag.has(notePath)) {
				addEdge(notePath, tagId);
			}
		}
	}

	// Add backlink concept nodes and edges for hop-1
	for (const linkedPath of focusAllLinks) {
		if (!hop1Set.has(linkedPath)) continue;
		// Direct link edge between focus and neighbour
		addEdge(focusFile.path, linkedPath);
	}

	// Depth 2: neighbours of neighbours
	if (settings.depth === 2) {
		const hop2Neighbours = new Set<string>();

		for (const hop1Path of hop1Set) {
			const hop1File = vault.getFileByPath(hop1Path);
			if (!hop1File) continue;

			const hop1Tags = getFileTags(hop1File, app);
			const hop1OutLinks = getOutLinks(hop1File, app);
			const hop1InLinks = getInLinks(hop1File, app);
			const hop1AllLinks = new Set([...hop1OutLinks, ...hop1InLinks]);

			// Tag connections from hop-1 neighbours
			for (const tag of hop1Tags) {
				const notesWithTag = tagToNotes.get(tag);
				if (!notesWithTag) continue;
				for (const notePath of notesWithTag) {
					if (notePath !== hop1Path && !nodeMap.has(notePath)) {
						hop2Neighbours.add(notePath);
					}
				}
				// Add tag concept if shared between hop-1 nodes
				const tagId = `tag:${tag}`;
				if (!nodeMap.has(tagId) && notesWithTag.size > 1) {
					nodeMap.set(tagId, {
						id: tagId,
						type: 'tag',
						label: tag,
						hopLevel: 2,
					});
				}
				if (nodeMap.has(tagId)) {
					addEdge(hop1Path, tagId);
				}
			}

			// Backlink connections from hop-1 neighbours
			for (const linkedPath of hop1AllLinks) {
				if (!nodeMap.has(linkedPath)) {
					hop2Neighbours.add(linkedPath);
				}
				if (hop1Set.has(linkedPath) || linkedPath === focusFile.path) {
					addEdge(hop1Path, linkedPath);
				}
			}
		}

		// Cap hop-2 neighbours
		const remainingCap = Math.max(0, settings.maxNeighbours - hop1Set.size);
		const hop2Array = [...hop2Neighbours].slice(0, remainingCap);

		for (const notePath of hop2Array) {
			const file = vault.getFileByPath(notePath);
			if (!file) continue;
			nodeMap.set(notePath, {
				id: notePath,
				type: 'note',
				label: file.basename,
				path: file.parent?.path ?? '',
				hopLevel: 2,
			});

			// Add edges from hop-2 to their connecting hop-1 neighbours
			const hop2Tags = getFileTags(file, app);
			for (const tag of hop2Tags) {
				const tagId = `tag:${tag}`;
				if (nodeMap.has(tagId)) {
					addEdge(notePath, tagId);
				}
			}

			const hop2Links = new Set([...getOutLinks(file, app), ...getInLinks(file, app)]);
			for (const linkedPath of hop2Links) {
				if (hop1Set.has(linkedPath)) {
					addEdge(notePath, linkedPath);
				}
			}
		}
	}

	return {
		nodes: [...nodeMap.values()],
		edges,
		truncated: truncated > 0 ? truncated : undefined,
	};

	function addEdge(source: string, target: string): void {
		const key = `${source}→${target}`;
		const reverseKey = `${target}→${source}`;
		if (edgeSet.has(key) || edgeSet.has(reverseKey)) return;
		edgeSet.add(key);
		edges.push({ source, target });
	}
}

function getFileTags(file: TFile, app: App): Set<string> {
	const cache = app.metadataCache.getFileCache(file);
	const tags = new Set<string>();
	if (!cache) return tags;

	// Inline tags
	if (cache.tags) {
		for (const t of cache.tags) {
			tags.add(t.tag.toLowerCase());
		}
	}

	// Frontmatter tags
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

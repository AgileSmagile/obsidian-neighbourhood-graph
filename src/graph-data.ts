import type { App, TFile } from 'obsidian';
import type { GraphData, GraphNode, GraphEdge, NeighbourhoodGraphSettings, EdgeRelationType } from './types';

/**
 * Build a neighbourhood subgraph centred on the focus file.
 *
 * Always shows direct neighbours only (1-hop data). The depth setting
 * controls visual highlight tiers on hover, not which nodes appear.
 *
 * Neighbours are ranked by connection strength (shared tags + direct links)
 * and capped at maxNeighbours.
 */
/** Strength bonus added per explicit Excalibrain relationship type */
const RELATION_STRENGTH_BONUS: Record<EdgeRelationType, number> = {
	parent: 3,
	child: 3,
	leftFriend: 1,
	rightFriend: 1,
	previous: 1,
	next: 1,
};

export function buildNeighbourhood(
	focusFile: TFile,
	app: App,
	settings: NeighbourhoodGraphSettings,
	excalibrainFields: Map<string, EdgeRelationType> | null = null,
): GraphData {
	const vault = app.vault;
	const allFiles = vault.getMarkdownFiles();

	// Build reverse-link index once (avoids O(n²) per getInLinks call)
	const allResolved = app.metadataCache.resolvedLinks;
	const reverseLinks = new Map<string, Set<string>>();
	for (const [sourcePath, targets] of Object.entries(allResolved)) {
		for (const targetPath of Object.keys(targets)) {
			if (!reverseLinks.has(targetPath)) reverseLinks.set(targetPath, new Set());
			reverseLinks.get(targetPath)!.add(sourcePath);
		}
	}

	const focusTags = getFileTags(focusFile, app);
	const focusOutLinks = getOutLinks(focusFile, app);
	const focusInLinks = reverseLinks.get(focusFile.path) ?? new Set<string>();
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
		const outCount = Object.keys(allResolved[notePath] ?? {}).length;
		const inCount = (reverseLinks.get(notePath) ?? new Set()).size;
		const hubScore = Math.log2(Math.max(1, outCount + inCount));
		neighbourStrength.set(notePath, (neighbourStrength.get(notePath) ?? 0) + hubScore);
	}

	// Excalibrain bonus: explicit typed relationships carry more weight than plain links
	if (excalibrainFields) {
		// Check focus note's frontmatter for outbound typed links
		for (const fmLink of getFrontmatterLinks(focusFile, app)) {
			const relType = excalibrainFields.get(fmLink.key.toLowerCase());
			if (!relType) continue;
			const targetPath = app.metadataCache.getFirstLinkpathDest(fmLink.link, focusFile.path)?.path;
			if (targetPath && neighbourStrength.has(targetPath)) {
				neighbourStrength.set(targetPath, (neighbourStrength.get(targetPath) ?? 0) + RELATION_STRENGTH_BONUS[relType]);
			}
		}
		// Check each potential neighbour's frontmatter for typed links back to focus
		for (const [notePath] of neighbourStrength) {
			const file = app.vault.getFileByPath(notePath);
			if (!file) continue;
			for (const fmLink of getFrontmatterLinks(file, app)) {
				const relType = excalibrainFields.get(fmLink.key.toLowerCase());
				if (!relType) continue;
				const targetPath = app.metadataCache.getFirstLinkpathDest(fmLink.link, notePath)?.path;
				if (targetPath === focusFile.path) {
					neighbourStrength.set(notePath, (neighbourStrength.get(notePath) ?? 0) + RELATION_STRENGTH_BONUS[relType]);
				}
			}
		}
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

	// Add direct link edges between focus and neighbours, typed where Excalibrain fields match
	for (const linkedPath of focusAllLinks) {
		if (!neighbourSet.has(linkedPath)) continue;
		const relType = excalibrainFields
			? detectRelationType(focusFile.path, linkedPath, app, excalibrainFields)
			: undefined;
		addEdge(focusFile.path, linkedPath, relType);
	}

	return {
		nodes: [...nodeMap.values()],
		edges,
		truncated: truncated > 0 ? truncated : undefined,
	};

	function addEdge(source: string, target: string, relationType?: EdgeRelationType): void {
		const key = `${source}\u2192${target}`;
		const reverseKey = `${target}\u2192${source}`;
		if (edgeSet.has(key) || edgeSet.has(reverseKey)) return;
		edgeSet.add(key);
		edges.push(relationType ? { source, target, relationType } : { source, target });
	}
}

function getFrontmatterLinks(file: TFile, app: App): Array<{ key: string; link: string }> {
	return app.metadataCache.getFileCache(file)?.frontmatterLinks ?? [];
}

function detectRelationType(
	sourcePath: string,
	targetPath: string,
	app: App,
	fieldLookup: Map<string, EdgeRelationType>,
): EdgeRelationType | undefined {
	// Check source → target direction
	const sourceFile = app.vault.getFileByPath(sourcePath);
	if (sourceFile) {
		for (const fmLink of getFrontmatterLinks(sourceFile, app)) {
			const relType = fieldLookup.get(fmLink.key.toLowerCase());
			if (!relType) continue;
			const resolved = app.metadataCache.getFirstLinkpathDest(fmLink.link, sourcePath)?.path;
			if (resolved === targetPath) return relType;
		}
	}
	// Check target → source direction (backlink carries inverse type)
	const targetFile = app.vault.getFileByPath(targetPath);
	if (targetFile) {
		for (const fmLink of getFrontmatterLinks(targetFile, app)) {
			const relType = fieldLookup.get(fmLink.key.toLowerCase());
			if (!relType) continue;
			const resolved = app.metadataCache.getFirstLinkpathDest(fmLink.link, targetPath)?.path;
			if (resolved === sourcePath) return inverseType(relType);
		}
	}
	return undefined;
}

function inverseType(type: EdgeRelationType): EdgeRelationType {
	switch (type) {
		case 'parent': return 'child';
		case 'child': return 'parent';
		case 'previous': return 'next';
		case 'next': return 'previous';
		default: return type; // friends/opposes are symmetric
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


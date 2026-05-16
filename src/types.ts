export interface GraphNode {
	id: string;
	type: 'note' | 'tag' | 'backlink';
	label: string;
	path?: string;
	focus?: boolean;
	hopLevel?: number;
}

export interface GraphEdge {
	source: string;
	target: string;
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
	truncated?: number;
}

export interface ColourGroup {
	query: string;
	colour: string;
}

export interface NeighbourhoodGraphSettings {
	depth: 1 | 2;
	maxNeighbours: number;
	colourGroups: ColourGroup[];
	defaultNodeColour: string;
	tagConceptColour: string;
	backlinkConceptColour: string;
	lineColour: number;
	lineThickness: number;
	spread: number;
	linkPull: number;
	showPathInTooltip: boolean;
}

export const DEFAULT_SETTINGS: NeighbourhoodGraphSettings = {
	depth: 1,
	maxNeighbours: 100,
	colourGroups: [],
	defaultNodeColour: '#6b7280',
	tagConceptColour: '#d4a017',
	backlinkConceptColour: '#60a5fa',
	lineColour: 75,
	lineThickness: 1,
	spread: 5,
	linkPull: 5,
	showPathInTooltip: true,
};

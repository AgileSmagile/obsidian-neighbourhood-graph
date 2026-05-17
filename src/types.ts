export interface GraphNode {
	id: string;
	type: 'note' | 'tag';
	label: string;
	path?: string;
	focus?: boolean;
	/** Connection strength to the focus note (tags + links + hub score) */
	strength?: number;
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
	/** Controls hover highlight depth: 1 = direct only, 2 = direct + secondary */
	depth: 1 | 2;
	maxNeighbours: number;
	colourGroups: ColourGroup[];
	defaultNodeColour: string;
	tagConceptColour: string;
	/** 0 = all same size, 10 = dramatic size difference by salience */
	salienceImpact: number;
	lineColour: number;
	lineThickness: number;
	spread: number;
	linkPull: number;
	showPathInTooltip: boolean;
}

export const DEFAULT_SETTINGS: NeighbourhoodGraphSettings = {
	depth: 2,
	maxNeighbours: 30,
	colourGroups: [],
	defaultNodeColour: '#6b7280',
	tagConceptColour: '#d4a017',
	salienceImpact: 5,
	lineColour: 75,
	lineThickness: 1,
	spread: 5,
	linkPull: 5,
	showPathInTooltip: true,
};

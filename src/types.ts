export interface GraphNode {
	id: string;
	type: 'note' | 'tag';
	label: string;
	path?: string;
	focus?: boolean;
	/** Connection strength to the focus note (tags + links + hub score) */
	strength?: number;
}

export type EdgeRelationType = 'parent' | 'child' | 'leftFriend' | 'rightFriend' | 'previous' | 'next';

export interface GraphEdge {
	source: string;
	target: string;
	/** Set when the link was declared via an Excalibrain relationship field */
	relationType?: EdgeRelationType;
}

/**
 * Subset of Excalibrain's data.json that we care about.
 * Each array contains the frontmatter field names the user has mapped
 * to that relationship type (case-insensitive at match time).
 */
export interface ExcalibrainConfig {
	parents: string[];
	children: string[];
	leftFriends: string[];
	rightFriends: string[];
	previous: string[];
	next: string[];
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
	/** 0 = all same size, 10 = dramatic size difference by salience */
	salienceImpact: number;
	lineColour: number;
	lineThickness: number;
	spread: number;
	linkPull: number;
	showPathInTooltip: boolean;
	/** Whether to read Excalibrain's relationship fields when Excalibrain is installed */
	excalibrainEnabled: boolean;
}

export const DEFAULT_SETTINGS: NeighbourhoodGraphSettings = {
	depth: 2,
	maxNeighbours: 30,
	colourGroups: [],
	defaultNodeColour: '#6b7280',
	salienceImpact: 5,
	lineColour: 75,
	lineThickness: 1,
	spread: 5,
	linkPull: 5,
	showPathInTooltip: true,
	excalibrainEnabled: true,
};

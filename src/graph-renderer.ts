import * as d3 from 'd3';
import type { GraphData, GraphNode, NeighbourhoodGraphSettings, ColourGroup } from './types';

const NOTE_R_MIN = 8;
const NOTE_R_MAX = 18;
const FOCUS_R = 20;
const TAG_R = 6;
const HIGHLIGHT_COLOUR = '#fbbf24';

interface SimNode extends GraphNode, d3.SimulationNodeDatum {
	/** Computed display radius based on connection strength */
	r: number;
}
interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
	source: SimNode | string;
	target: SimNode | string;
}

export interface RendererCallbacks {
	onNodeClick: (nodeId: string) => void;
	onNodeDoubleClick: (nodeId: string) => void;
}

function greyFromSlider(v: number): string {
	const level = Math.round(220 - v * 2.05);
	return `rgb(${level},${level},${level})`;
}

function widthFromSlider(v: number): number {
	return 0.5 + (v - 1) * (2.5 / 9);
}

function chargeFromSlider(v: number): number {
	return -50 - (v - 1) * (450 / 9);
}

function distanceFromSlider(v: number): number {
	return 50 + (v - 1) * (150 / 9);
}

function nodeRadius(node: SimNode): number {
	return node.r;
}

/**
 * Scale note radii by connection strength, controlled by salienceImpact.
 *   0 = all same size (mid-range)
 *  10 = dramatic: weakest at 10% of max, strongest at max
 * Focus gets fixed max size.
 */
function computeRadii(nodes: SimNode[], salienceImpact: number): void {
	const noteNodes = nodes.filter((n) => n.type === 'note' && !n.focus);
	const strengths = noteNodes.map((n) => n.strength ?? 0);
	const minStr = Math.min(...strengths, 0);
	const maxStr = Math.max(...strengths, 1);
	const range = maxStr - minStr;

	// impact 0 → minR = maxR (uniform). impact 10 → minR = maxR * 0.1
	const impactFactor = salienceImpact / 10;
	const uniformR = (NOTE_R_MIN + NOTE_R_MAX) / 2;
	const effectiveMin = NOTE_R_MAX - impactFactor * (NOTE_R_MAX - NOTE_R_MIN);

	for (const node of nodes) {
		if (node.type !== 'note') {
			node.r = TAG_R;
		} else if (node.focus) {
			node.r = FOCUS_R;
		} else if (impactFactor === 0 || range === 0) {
			node.r = uniformR;
		} else {
			const s = node.strength ?? 0;
			const t = (s - minStr) / range;
			const curved = Math.sqrt(t);
			node.r = effectiveMin + curved * (NOTE_R_MAX - effectiveMin);
		}
	}
}

function matchesColourGroup(node: GraphNode, group: ColourGroup): boolean {
	const q = group.query.trim().toLowerCase();
	if (q.startsWith('path:')) {
		const prefix = q.slice(5);
		return (node.path ?? '').toLowerCase().startsWith(prefix);
	}
	if (q.startsWith('tag:')) {
		const tag = q.slice(4);
		return node.id.toLowerCase().includes(tag);
	}
	return node.label.toLowerCase().includes(q);
}

function getNodeColour(node: GraphNode, settings: NeighbourhoodGraphSettings, defaultColour: string): string {
	if (node.type === 'tag') return settings.tagConceptColour;

	for (const group of settings.colourGroups) {
		if (matchesColourGroup(node, group)) return group.colour;
	}
	return defaultColour;
}

function getEdgeNodeId(node: SimNode | string): string {
	return typeof node === 'string' ? node : node.id;
}

export class GraphRenderer {
	private container: HTMLElement;
	private settings: NeighbourhoodGraphSettings;
	private callbacks: RendererCallbacks;
	private simulation: d3.Simulation<SimNode, SimEdge> | null = null;
	private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;
	private _link: d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown> | null = null;
	private _simulation: d3.Simulation<SimNode, SimEdge> | null = null;
	private _currentLineColour: () => string = () => '';
	private _currentLineWidth: () => number = () => 1;
	private _setLineColour: (v: string) => void = () => {};
	private _setLineWidth: (v: number) => void = () => {};

	constructor(
		container: HTMLElement,
		settings: NeighbourhoodGraphSettings,
		callbacks: RendererCallbacks,
	) {
		this.container = container;
		this.settings = settings;
		this.callbacks = callbacks;
	}

	render(data: GraphData): void {
		this.destroy();

		const W = this.container.clientWidth || 300;
		const H = this.container.clientHeight || 400;
		const dark = document.body.classList.contains('theme-dark');

		const textColour = dark ? '#e5e7eb' : '#111827';
		const tagTextColour = dark ? '#9ca3af' : '#6b7280';

		// Default node colour: user setting, or theme accent, or fallback grey
		const themeAccent = getComputedStyle(document.body)
			.getPropertyValue('--interactive-accent').trim();
		const defaultNodeColour = this.settings.defaultNodeColour !== '#6b7280'
			? this.settings.defaultNodeColour
			: (themeAccent || '#6b7280');

		const initLineColour = greyFromSlider(this.settings.lineColour);
		const initLineWidth = widthFromSlider(this.settings.lineThickness);

		let currentLineColour = initLineColour;
		let currentLineWidth = initLineWidth;

		this.svg = d3.select(this.container)
			.append('svg')
			.attr('width', W)
			.attr('height', H)
			.classed('neighbourhood-graph-svg', true);

		const defs = this.svg.append('defs');
		const filter = defs.append('filter')
			.attr('id', 'nh-link-glow')
			.attr('x', '-50%').attr('y', '-50%')
			.attr('width', '200%').attr('height', '200%');
		filter.append('feGaussianBlur')
			.attr('in', 'SourceGraphic')
			.attr('stdDeviation', '2.5')
			.attr('result', 'blur');
		const merge = filter.append('feMerge');
		merge.append('feMergeNode').attr('in', 'blur');
		merge.append('feMergeNode').attr('in', 'SourceGraphic');

		// Focus node glow filter
		const focusGlow = defs.append('filter')
			.attr('id', 'nh-focus-glow')
			.attr('x', '-100%').attr('y', '-100%')
			.attr('width', '300%').attr('height', '300%');
		focusGlow.append('feGaussianBlur')
			.attr('in', 'SourceGraphic')
			.attr('stdDeviation', '4')
			.attr('result', 'blur');
		const focusMerge = focusGlow.append('feMerge');
		focusMerge.append('feMergeNode').attr('in', 'blur');
		focusMerge.append('feMergeNode').attr('in', 'SourceGraphic');

		const g = this.svg.append('g');
		this.svg.call(
			d3.zoom<SVGSVGElement, unknown>()
				.scaleExtent([0.3, 3])
				.on('zoom', (e) => g.attr('transform', e.transform as unknown as string)) as never,
		);

		const nodes: SimNode[] = data.nodes.map((n) => ({ ...n, r: 0 }));
		const edges: SimEdge[] = data.edges.map((e) => ({ ...e }));
		computeRadii(nodes, this.settings.salienceImpact);

		this.simulation = d3.forceSimulation(nodes)
			.force('link', d3.forceLink<SimNode, SimEdge>(edges)
				.id((d) => d.id)
				.distance(distanceFromSlider(this.settings.linkPull))
				.strength(0.55))
			.force('charge', d3.forceManyBody()
				.strength(chargeFromSlider(this.settings.spread)))
			.force('center', d3.forceCenter(W / 2, H / 2).strength(0.04))
			.force('collision', d3.forceCollide<SimNode>((d) => d.r + 24))
			.force('radial', d3.forceRadial<SimNode>(
				(d) => d.type === 'note' ? Math.min(W, H) * 0.34 : 0,
				W / 2, H / 2,
			).strength((d) => d.type === 'note' ? 0.12 : 0.06));

		const link = g.append('g')
			.selectAll<SVGLineElement, SimEdge>('line')
			.data(edges)
			.join('line')
			.attr('stroke', initLineColour)
			.attr('stroke-width', initLineWidth)
			.attr('stroke-opacity', 0.9);

		const depth = this.settings.depth;

		const highlightNode = (d: SimNode): void => {
			const directIds = new Set<string>(
				edges.flatMap((edge) => {
					const srcId = getEdgeNodeId(edge.source);
					const tgtId = getEdgeNodeId(edge.target);
					return srcId === d.id || tgtId === d.id ? [srcId, tgtId] : [];
				}),
			);
			directIds.delete(d.id);

			const secondaryIds = new Set<string>();
			if (depth === 2) {
				edges.forEach((edge) => {
					const srcId = getEdgeNodeId(edge.source);
					const tgtId = getEdgeNodeId(edge.target);
					if (directIds.has(srcId) && tgtId !== d.id) secondaryIds.add(tgtId);
					if (directIds.has(tgtId) && srcId !== d.id) secondaryIds.add(srcId);
				});
				directIds.forEach((id) => secondaryIds.delete(id));
			}

			const edgeLinkType = (e: SimEdge): 'primary' | 'secondary' | 'none' => {
				const srcId = getEdgeNodeId(e.source);
				const tgtId = getEdgeNodeId(e.target);
				if (srcId === d.id || tgtId === d.id) return 'primary';
				if (depth === 2) {
					const srcDirect = directIds.has(srcId);
					const tgtDirect = directIds.has(tgtId);
					if ((srcDirect && secondaryIds.has(tgtId)) || (tgtDirect && secondaryIds.has(srcId))) return 'secondary';
				}
				return 'none';
			};

			link
				.attr('stroke', (e) => edgeLinkType(e) !== 'none' ? HIGHLIGHT_COLOUR : currentLineColour)
				.attr('stroke-width', (e) => {
					const t = edgeLinkType(e);
					return t === 'primary' ? Math.max(currentLineWidth + 1.5, 2) :
						t === 'secondary' ? Math.max(currentLineWidth + 0.5, 1) : currentLineWidth;
				})
				.attr('stroke-opacity', (e) => {
					const t = edgeLinkType(e);
					return t === 'primary' ? 1 : t === 'secondary' ? 0.25 : 0.12;
				})
				.attr('filter', (e) => edgeLinkType(e) === 'primary' ? 'url(#nh-link-glow)' : null);

			node.attr('opacity', (n) => {
				if (n.id === d.id || directIds.has(n.id)) return 1;
				if (depth === 2 && secondaryIds.has(n.id)) return 0.6;
				return 0.25;
			});
		};

		const clearHighlight = (): void => {
			link
				.attr('stroke', currentLineColour)
				.attr('stroke-width', currentLineWidth)
				.attr('stroke-opacity', 0.9)
				.attr('filter', null);
			node.attr('opacity', 1);
		};

		let clickTimer: ReturnType<typeof setTimeout> | null = null;

		const node = g.append('g')
			.selectAll<SVGGElement, SimNode>('g')
			.data(nodes)
			.join('g')
			.attr('cursor', (d) => d.type === 'note' && !d.focus ? 'pointer' : 'default')
			.call(d3.drag<SVGGElement, SimNode>()
				.on('start', (e, d) => {
					if (!e.active && this.simulation) this.simulation.alphaTarget(0.01).restart();
					d.fx = d.x;
					d.fy = d.y;
					highlightNode(d);
				})
				.on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
				.on('end', (e, d) => {
					if (!e.active && this.simulation) this.simulation.alpha(0.005).alphaTarget(0);
					d.fx = null;
					d.fy = null;
					clearHighlight();
				}),
			)
			.on('mouseenter', (_, d) => highlightNode(d))
			.on('mouseleave', () => clearHighlight())
			.on('click', (_, d) => {
				if (d.type !== 'note') return;
				if (clickTimer) {
					clearTimeout(clickTimer);
					clickTimer = null;
					this.callbacks.onNodeDoubleClick(d.id);
				} else {
					clickTimer = setTimeout(() => {
						clickTimer = null;
						this.callbacks.onNodeClick(d.id);
					}, 250);
				}
			});

		// Render node shapes — sized by connection strength
		const settingsRef = this.settings;
		node.each(function (this: SVGGElement, d: SimNode) {
			const sel = d3.select(this);
			if (d.type === 'note') {
				const fill = getNodeColour(d, settingsRef, defaultNodeColour);
				if (d.focus) {
					sel.append('circle')
						.attr('r', d.r + 4)
						.attr('fill', 'none')
						.attr('stroke', HIGHLIGHT_COLOUR)
						.attr('stroke-width', 2)
						.attr('stroke-opacity', 0.4)
						.attr('filter', 'url(#nh-focus-glow)');
				}
				sel.append('circle')
					.attr('r', d.r)
					.attr('fill', fill)
					.attr('stroke', d.focus ? HIGHLIGHT_COLOUR : '#fff')
					.attr('stroke-width', d.focus ? 3 : 1.5);
			} else {
				// Tag — diamond
				const r = d.r;
				sel.append('polygon')
					.attr('points', `0,${-r} ${r},0 0,${r} ${-r},0`)
					.attr('fill', getNodeColour(d, settingsRef, defaultNodeColour))
					.attr('stroke', '#fff')
					.attr('stroke-width', 1);
			}
		});

		// Node labels — font size scales with node radius for notes
		node.append('text')
			.attr('text-anchor', 'middle')
			.attr('font-size', (d) => {
				if (d.focus) return '12px';
				if (d.type !== 'note') return '9px';
				return `${Math.round(8 + (d.r - NOTE_R_MIN) / (NOTE_R_MAX - NOTE_R_MIN) * 3)}px`;
			})
			.attr('font-weight', (d) => d.focus ? '700' : '400')
			.attr('fill', (d) => d.type === 'note' ? textColour : tagTextColour)
			.attr('pointer-events', 'none')
			.each(function (d: SimNode) {
				const sel = d3.select(this);
				const words = d.label.split(/[\s-]+/);
				const mid = Math.ceil(words.length / 2);
				const line1 = words.slice(0, mid).join(' ');
				const line2 = words.length > 1 ? words.slice(mid).join(' ') : '';
				sel.append('tspan')
					.attr('x', 0)
					.attr('dy', line2 ? -(d.r + 16) : -(d.r + 4))
					.text(line1);
				if (line2) {
					sel.append('tspan').attr('x', 0).attr('dy', 12).text(line2);
				}
			});

		// Tooltip
		const tooltip = d3.select(this.container)
			.append('div')
			.classed('neighbourhood-graph-tooltip', true)
			.style('position', 'absolute')
			.style('pointer-events', 'none')
			.style('opacity', '0');

		const showPath = this.settings.showPathInTooltip;

		node
			.on('mouseover', (_, d) => {
				let html = `<strong>${d.label}</strong>`;
				if (d.focus) html += ' <em>(focus)</em>';
				if (d.type === 'note' && showPath && d.path) {
					html += `<br/><span class="neighbourhood-graph-tooltip-sub">${d.path}</span>`;
				} else if (d.type === 'tag') {
					html += `<br/><span class="neighbourhood-graph-tooltip-sub">shared tag</span>`;
				}
				tooltip.style('opacity', '1').html(html);
			})
			.on('mousemove', (e) => {
				const rect = this.container.getBoundingClientRect();
				const tooltipEl = tooltip.node() as HTMLElement;
				const tw = tooltipEl.offsetWidth;
				const th = tooltipEl.offsetHeight;
				let left = e.clientX - rect.left + 12;
				let top = e.clientY - rect.top - th - 8;
				if (left + tw > rect.width) left = e.clientX - rect.left - tw - 12;
				if (top < 0) top = e.clientY - rect.top + 12;
				tooltip.style('left', `${left}px`).style('top', `${top}px`);
			})
			.on('mouseout', () => tooltip.style('opacity', '0'));

		// Tick
		this.simulation.on('tick', () => {
			link
				.attr('x1', (d) => (d.source as SimNode).x ?? 0)
				.attr('y1', (d) => (d.source as SimNode).y ?? 0)
				.attr('x2', (d) => (d.target as SimNode).x ?? 0)
				.attr('y2', (d) => (d.target as SimNode).y ?? 0);
			node.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
		});

		// Store references for slider controls
		this._link = link;
		this._simulation = this.simulation;
		this._currentLineColour = () => currentLineColour;
		this._currentLineWidth = () => currentLineWidth;
		this._setLineColour = (v: string) => { currentLineColour = v; };
		this._setLineWidth = (v: number) => { currentLineWidth = v; };
	}

	updateSlider(name: 'lineColour' | 'lineThickness' | 'spread' | 'linkPull', value: number): void {
		if (!this._link || !this._simulation) return;

		switch (name) {
			case 'lineColour': {
				const colour = greyFromSlider(value);
				this._setLineColour(colour);
				this._link.attr('stroke', colour);
				break;
			}
			case 'lineThickness': {
				const width = widthFromSlider(value);
				this._setLineWidth(width);
				this._link.attr('stroke-width', width);
				break;
			}
			case 'spread': {
				(this._simulation.force('charge') as d3.ForceManyBody<SimNode>)
					.strength(chargeFromSlider(value));
				this._simulation.alphaTarget(0.3).restart();
				setTimeout(() => this._simulation?.alphaTarget(0), 1500);
				break;
			}
			case 'linkPull': {
				(this._simulation.force('link') as d3.ForceLink<SimNode, SimEdge>)
					.distance(distanceFromSlider(value));
				this._simulation.alphaTarget(0.3).restart();
				setTimeout(() => this._simulation?.alphaTarget(0), 1500);
				break;
			}
		}
	}

	destroy(): void {
		if (this.simulation) {
			this.simulation.stop();
			this.simulation = null;
		}
		// Only remove elements the renderer created, not persistent overlays
		if (this.svg) {
			this.svg.remove();
			this.svg = null;
		}
		const tooltip = this.container.querySelector('.neighbourhood-graph-tooltip');
		if (tooltip) tooltip.remove();
		this._link = null;
		this._simulation = null;
	}
}

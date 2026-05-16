import * as d3 from 'd3';
import type { GraphData, GraphNode, GraphEdge, NeighbourhoodGraphSettings, ColourGroup } from './types';

const NOTE_R = 13;
const FOCUS_R = 15;
const TAG_R = 6;
const HIGHLIGHT_COLOUR = '#fbbf24';

interface SimNode extends GraphNode, d3.SimulationNodeDatum {}
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

function nodeRadius(node: GraphNode): number {
	if (node.type !== 'note') return TAG_R;
	return node.focus ? FOCUS_R : NOTE_R;
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

function getNodeColour(node: GraphNode, settings: NeighbourhoodGraphSettings): string {
	if (node.type === 'tag') return settings.tagConceptColour;
	if (node.type === 'backlink') return settings.backlinkConceptColour;

	for (const group of settings.colourGroups) {
		if (matchesColourGroup(node, group)) return group.colour;
	}
	return settings.defaultNodeColour;
}

export class GraphRenderer {
	private container: HTMLElement;
	private settings: NeighbourhoodGraphSettings;
	private callbacks: RendererCallbacks;
	private simulation: d3.Simulation<SimNode, SimEdge> | null = null;
	private svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null = null;

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

		const g = this.svg.append('g');
		this.svg.call(
			d3.zoom<SVGSVGElement, unknown>()
				.scaleExtent([0.3, 3])
				.on('zoom', (e) => g.attr('transform', e.transform as unknown as string)) as never,
		);

		const nodes: SimNode[] = data.nodes.map((n) => ({ ...n }));
		const edges: SimEdge[] = data.edges.map((e) => ({ ...e }));

		const focusNode = nodes.find((n) => n.focus);
		const focusId = focusNode?.id ?? '';

		this.simulation = d3.forceSimulation(nodes)
			.force('link', d3.forceLink<SimNode, SimEdge>(edges)
				.id((d) => d.id)
				.distance(distanceFromSlider(this.settings.linkPull))
				.strength(0.55))
			.force('charge', d3.forceManyBody()
				.strength(chargeFromSlider(this.settings.spread)))
			.force('center', d3.forceCenter(W / 2, H / 2).strength(0.04))
			.force('collision', d3.forceCollide<SimNode>((d) => {
				if (d.type !== 'note') return TAG_R + 28;
				return (d.focus ? FOCUS_R : NOTE_R) + 38;
			}))
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

		const highlightNode = (d: SimNode): void => {
			const directIds = new Set<string>(
				edges.flatMap((edge) => {
					const srcId = typeof edge.source === 'string' ? edge.source : (edge.source as SimNode).id;
					const tgtId = typeof edge.target === 'string' ? edge.target : (edge.target as SimNode).id;
					return srcId === d.id || tgtId === d.id ? [srcId, tgtId] : [];
				}),
			);
			directIds.delete(d.id);

			const secondaryIds = new Set<string>();
			edges.forEach((edge) => {
				const srcId = typeof edge.source === 'string' ? edge.source : (edge.source as SimNode).id;
				const tgtId = typeof edge.target === 'string' ? edge.target : (edge.target as SimNode).id;
				if (directIds.has(srcId) && tgtId !== d.id) secondaryIds.add(tgtId);
				if (directIds.has(tgtId) && srcId !== d.id) secondaryIds.add(srcId);
			});
			directIds.forEach((id) => secondaryIds.delete(id));

			const edgeLinkType = (e: SimEdge): 'primary' | 'secondary' | 'none' => {
				const srcId = typeof e.source === 'string' ? e.source : (e.source as SimNode).id;
				const tgtId = typeof e.target === 'string' ? e.target : (e.target as SimNode).id;
				if (srcId === d.id || tgtId === d.id) return 'primary';
				const srcDirect = directIds.has(srcId);
				const tgtDirect = directIds.has(tgtId);
				if ((srcDirect && secondaryIds.has(tgtId)) || (tgtDirect && secondaryIds.has(srcId))) return 'secondary';
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
				if (secondaryIds.has(n.id)) return 0.6;
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

		// Render node shapes
		node.each(function (d: SimNode) {
			const sel = d3.select(this);
			const settings_ref = (sel.node() as SVGGElement).ownerDocument.defaultView;
			if (d.type === 'note') {
				const r = d.focus ? FOCUS_R : NOTE_R;
				const fill = getNodeColour(d, this.__settings);
				sel.append('circle')
					.attr('r', r)
					.attr('fill', fill)
					.attr('stroke', d.focus ? HIGHLIGHT_COLOUR : '#fff')
					.attr('stroke-width', d.focus ? 3 : 1.5);
			} else if (d.type === 'tag') {
				sel.append('polygon')
					.attr('points', `0,${-TAG_R} ${TAG_R},0 0,${TAG_R} ${-TAG_R},0`)
					.attr('fill', getNodeColour(d, this.__settings))
					.attr('stroke', '#fff')
					.attr('stroke-width', 1);
			} else {
				// backlink — square
				const half = TAG_R;
				sel.append('rect')
					.attr('x', -half).attr('y', -half)
					.attr('width', half * 2).attr('height', half * 2)
					.attr('fill', getNodeColour(d, this.__settings))
					.attr('stroke', '#fff')
					.attr('stroke-width', 1);
			}
		}.bind({ __settings: this.settings }));

		// Node labels
		node.append('text')
			.attr('text-anchor', 'middle')
			.attr('font-size', (d) => d.focus ? '11px' : '10px')
			.attr('font-weight', (d) => d.focus ? '600' : '400')
			.attr('fill', (d) => d.type === 'note' ? textColour : tagTextColour)
			.attr('pointer-events', 'none')
			.each(function (d: SimNode) {
				const sel = d3.select(this);
				const words = d.label.split(/[\s-]+/);
				const mid = Math.ceil(words.length / 2);
				const line1 = words.slice(0, mid).join(' ');
				const line2 = words.length > 1 ? words.slice(mid).join(' ') : '';
				const r = nodeRadius(d);
				sel.append('tspan')
					.attr('x', 0)
					.attr('dy', line2 ? -(r + 16) : -(r + 4))
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
					html += `<br/><span class="neighbourhood-graph-tooltip-sub">tag</span>`;
				} else if (d.type === 'backlink') {
					html += `<br/><span class="neighbourhood-graph-tooltip-sub">backlink target</span>`;
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
		this.container.empty();
		this.svg = null;
		this._link = null;
		this._simulation = null;
	}

	// Internal references for slider updates
	private _link: d3.Selection<SVGLineElement, SimEdge, SVGGElement, unknown> | null = null;
	private _simulation: d3.Simulation<SimNode, SimEdge> | null = null;
	private _currentLineColour: () => string = () => '';
	private _currentLineWidth: () => number = () => 1;
	private _setLineColour: (v: string) => void = () => {};
	private _setLineWidth: (v: number) => void = () => {};
}

import { ItemView, WorkspaceLeaf, type TFile, debounce } from 'obsidian';
import type NeighbourhoodGraphPlugin from './main';
import { buildNeighbourhood } from './graph-data';
import { GraphRenderer } from './graph-renderer';

export const VIEW_TYPE = 'neighbourhood-graph';

export class NeighbourhoodGraphView extends ItemView {
	private plugin: NeighbourhoodGraphPlugin;
	private renderer: GraphRenderer | null = null;
	private graphContainer: HTMLElement | null = null;
	private controlsContainer: HTMLElement | null = null;
	private focusFile: TFile | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: NeighbourhoodGraphPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Neighbourhood graph';
	}

	getIcon(): string {
		return 'git-fork';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('neighbourhood-graph-container');

		// Depth toggle in header
		this.addAction('layers', 'Toggle depth (1 or 2 hops)', () => {
			const getSettings = () => this.plugin.settings;
			const newDepth = getSettings().depth === 1 ? 2 : 1;
			this.plugin.settings.depth = newDepth;
			this.plugin.saveSettings();
			this.rebuild();
		});

		// Controls panel
		this.controlsContainer = container.createDiv({ cls: 'neighbourhood-graph-controls' });
		this.buildControls();

		// Graph area
		this.graphContainer = container.createDiv({ cls: 'neighbourhood-graph-canvas' });

		// Listen for navigation
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', debounce(() => {
				this.onActiveLeafChange();
			}, 200, true)),
		);

		// Listen for metadata changes (new links/tags)
		this.registerEvent(
			this.app.metadataCache.on('resolved', debounce(() => {
				if (this.focusFile) this.rebuild();
			}, 500, true)),
		);

		// Initial render
		this.onActiveLeafChange();
	}

	async onClose(): Promise<void> {
		if (this.renderer) {
			this.renderer.destroy();
			this.renderer = null;
		}
	}

	private onActiveLeafChange(): void {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile || activeFile.extension !== 'md') return;
		if (activeFile.path === this.focusFile?.path) return;
		this.focusFile = activeFile;
		this.rebuild();
	}

	recentreOn(filePath: string): void {
		const file = this.app.vault.getFileByPath(filePath);
		if (!file) return;
		this.focusFile = file;
		this.rebuild();
	}

	private rebuild(): void {
		if (!this.focusFile || !this.graphContainer) return;

		const data = buildNeighbourhood(this.focusFile, this.app, this.plugin.settings);

		if (this.renderer) {
			this.renderer.destroy();
		}

		this.renderer = new GraphRenderer(
			this.graphContainer,
			this.plugin.settings,
			{
				onNodeClick: (nodeId: string) => {
					this.recentreOn(nodeId);
				},
				onNodeDoubleClick: (nodeId: string) => {
					const file = this.app.vault.getFileByPath(nodeId);
					if (file) {
						this.app.workspace.getLeaf(false).openFile(file);
					}
					this.recentreOn(nodeId);
				},
			},
		);
		this.renderer.render(data);

		// Update truncation indicator
		const existing = this.graphContainer.querySelector('.neighbourhood-graph-truncated');
		if (existing) existing.remove();
		if (data.truncated) {
			const indicator = this.graphContainer.createDiv({ cls: 'neighbourhood-graph-truncated' });
			indicator.setText(`${data.truncated} more notes not shown`);
		}
	}

	private buildControls(): void {
		if (!this.controlsContainer) return;
		this.controlsContainer.empty();

		const getSettings = () => this.plugin.settings;

		const sliders: Array<{
			label: string;
			key: 'lineColour' | 'lineThickness' | 'spread' | 'linkPull';
			min: number;
			max: number;
		}> = [
			{ label: 'Line colour', key: 'lineColour', min: 0, max: 100 },
			{ label: 'Line thickness', key: 'lineThickness', min: 1, max: 10 },
			{ label: 'Spread', key: 'spread', min: 1, max: 10 },
			{ label: 'Link pull', key: 'linkPull', min: 1, max: 10 },
		];

		const grid = this.controlsContainer.createDiv({ cls: 'neighbourhood-graph-slider-grid' });

		for (const s of sliders) {
			const wrapper = grid.createDiv({ cls: 'neighbourhood-graph-slider-wrapper' });
			wrapper.createEl('label', { text: s.label, cls: 'neighbourhood-graph-slider-label' });
			const input = wrapper.createEl('input', {
				type: 'range',
				cls: 'neighbourhood-graph-slider',
			});
			input.min = String(s.min);
			input.max = String(s.max);
			input.value = String(getSettings()[s.key]);

			input.addEventListener('input', () => {
				const val = Number(input.value);
				this.plugin.settings[s.key] = val as never;
				this.plugin.saveSettings();
				if (this.renderer) {
					this.renderer.updateSlider(s.key, val);
				}
			});
		}
	}
}

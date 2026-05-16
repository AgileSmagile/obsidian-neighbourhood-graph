import { ItemView, WorkspaceLeaf, Setting, type TFile, debounce } from 'obsidian';
import type NeighbourhoodGraphPlugin from './main';
import { buildNeighbourhood } from './graph-data';
import { GraphRenderer } from './graph-renderer';
import type { ColourGroup } from './types';

export const VIEW_TYPE = 'neighbourhood-graph';

export class NeighbourhoodGraphView extends ItemView {
	private plugin: NeighbourhoodGraphPlugin;
	private renderer: GraphRenderer | null = null;
	private graphContainer: HTMLElement | null = null;
	private settingsPanel: HTMLElement | null = null;
	private legendPanel: HTMLElement | null = null;
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
		const container = this.contentEl;
		container.empty();
		container.addClass('neighbourhood-graph-container');

		// Header actions — matching Obsidian graph view pattern
		this.addAction('settings', 'Graph settings', () => {
			this.settingsPanel?.toggleClass('is-hidden', !this.settingsPanel?.hasClass('is-hidden'));
		});

		this.addAction('help-circle', 'Legend and help', () => {
			this.legendPanel?.toggleClass('is-hidden', !this.legendPanel?.hasClass('is-hidden'));
		});

		// Settings panel (collapsible, hidden by default)
		this.settingsPanel = container.createDiv({ cls: 'neighbourhood-graph-panel is-hidden' });
		this.buildSettingsPanel();

		// Legend panel (collapsible, hidden by default)
		this.legendPanel = container.createDiv({ cls: 'neighbourhood-graph-panel is-hidden' });
		this.buildLegendPanel();

		// Graph area
		this.graphContainer = container.createDiv({ cls: 'neighbourhood-graph-canvas' });

		// Listen for navigation
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', debounce(() => {
				this.onActiveLeafChange();
			}, 200, true)),
		);

		// Listen for metadata changes
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
		const activeFile = this.app.workspace.getActiveFile()
			?? this.findActiveMarkdownFile();
		if (!activeFile || activeFile.extension !== 'md') return;
		if (activeFile.path === this.focusFile?.path) return;
		this.focusFile = activeFile;
		this.rebuild();
	}

	private findActiveMarkdownFile(): TFile | null {
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		for (const leaf of leaves) {
			const file = (leaf.view as { file?: TFile }).file;
			if (file && file.extension === 'md') return file;
		}
		return null;
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

		// Truncation indicator
		const existing = this.graphContainer.querySelector('.neighbourhood-graph-truncated');
		if (existing) existing.remove();
		if (data.truncated) {
			const indicator = this.graphContainer.createDiv({ cls: 'neighbourhood-graph-truncated' });
			indicator.setText(`${data.truncated} more notes not shown`);
		}
	}

	private buildSettingsPanel(): void {
		if (!this.settingsPanel) return;
		const panel = this.settingsPanel;
		panel.empty();

		panel.createEl('div', { text: 'Settings', cls: 'neighbourhood-graph-panel-heading' });

		// Depth toggle
		new Setting(panel)
			.setName('Highlight depth')
			.setDesc('Tiers of connection shown on hover')
			.addDropdown((drop) =>
				drop
					.addOption('1', '1 hop')
					.addOption('2', '2 hops')
					.setValue(String(this.plugin.settings.depth))
					.onChange(async (val) => {
						this.plugin.settings.depth = Number(val) as 1 | 2;
						await this.plugin.saveSettings();
						this.rebuild();
					}),
			);

		// Max neighbours
		new Setting(panel)
			.setName('Max neighbours')
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.maxNeighbours))
					.onChange(async (val) => {
						const num = parseInt(val, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxNeighbours = num;
							await this.plugin.saveSettings();
							this.rebuild();
						}
					}),
			);

		// Show path toggle
		new Setting(panel)
			.setName('Show path in tooltip')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showPathInTooltip)
					.onChange(async (val) => {
						this.plugin.settings.showPathInTooltip = val;
						await this.plugin.saveSettings();
						this.rebuild();
					}),
			);

		// Physics sliders
		panel.createEl('div', { text: 'Physics', cls: 'neighbourhood-graph-panel-subheading' });

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

		const grid = panel.createDiv({ cls: 'neighbourhood-graph-slider-grid' });
		for (const s of sliders) {
			const wrapper = grid.createDiv({ cls: 'neighbourhood-graph-slider-wrapper' });
			wrapper.createEl('label', { text: s.label, cls: 'neighbourhood-graph-slider-label' });
			const input = wrapper.createEl('input', { type: 'range', cls: 'neighbourhood-graph-slider' });
			input.min = String(s.min);
			input.max = String(s.max);
			input.value = String(this.plugin.settings[s.key]);

			input.addEventListener('input', () => {
				const val = Number(input.value);
				this.plugin.settings[s.key] = val as never;
				this.plugin.saveSettings();
				if (this.renderer) {
					this.renderer.updateSlider(s.key, val);
				}
			});
		}

		// Colours
		panel.createEl('div', { text: 'Colours', cls: 'neighbourhood-graph-panel-subheading' });

		new Setting(panel)
			.setName('Default node')
			.addColorPicker((picker) =>
				picker
					.setValue(this.plugin.settings.defaultNodeColour)
					.onChange(async (val) => {
						this.plugin.settings.defaultNodeColour = val;
						await this.plugin.saveSettings();
						this.rebuild();
					}),
			);

		new Setting(panel)
			.setName('Tag concept')
			.addColorPicker((picker) =>
				picker
					.setValue(this.plugin.settings.tagConceptColour)
					.onChange(async (val) => {
						this.plugin.settings.tagConceptColour = val;
						await this.plugin.saveSettings();
						this.rebuild();
					}),
			);

		new Setting(panel)
			.setName('Backlink concept')
			.addColorPicker((picker) =>
				picker
					.setValue(this.plugin.settings.backlinkConceptColour)
					.onChange(async (val) => {
						this.plugin.settings.backlinkConceptColour = val;
						await this.plugin.saveSettings();
						this.rebuild();
					}),
			);

		// Colour groups
		panel.createEl('div', { text: 'Colour groups', cls: 'neighbourhood-graph-panel-subheading' });
		panel.createEl('p', {
			text: 'Query-colour pairs: "path:folder/", "tag:#name", or text. First match wins.',
			cls: 'neighbourhood-graph-panel-desc',
		});

		const groupsContainer = panel.createDiv();
		for (let i = 0; i < this.plugin.settings.colourGroups.length; i++) {
			this.renderColourGroupInline(groupsContainer, i);
		}

		const addBtn = panel.createEl('button', { text: 'Add group', cls: 'neighbourhood-graph-add-group-btn' });
		addBtn.addEventListener('click', async () => {
			this.plugin.settings.colourGroups.push({ query: '', colour: '#6b7280' });
			await this.plugin.saveSettings();
			this.buildSettingsPanel();
		});
	}

	private renderColourGroupInline(container: HTMLElement, index: number): void {
		const group = this.plugin.settings.colourGroups[index];
		const row = container.createDiv({ cls: 'neighbourhood-graph-group-row' });

		const queryInput = row.createEl('input', {
			type: 'text',
			cls: 'neighbourhood-graph-group-query',
			placeholder: 'e.g. path:people/',
			value: group.query,
		});
		queryInput.addEventListener('change', async () => {
			this.plugin.settings.colourGroups[index].query = queryInput.value;
			await this.plugin.saveSettings();
			this.rebuild();
		});

		const colourInput = row.createEl('input', {
			type: 'color',
			cls: 'neighbourhood-graph-group-colour',
			value: group.colour,
		});
		colourInput.addEventListener('input', async () => {
			this.plugin.settings.colourGroups[index].colour = colourInput.value;
			await this.plugin.saveSettings();
			this.rebuild();
		});

		const removeBtn = row.createEl('button', { cls: 'neighbourhood-graph-group-remove', text: '\u00d7' });
		removeBtn.addEventListener('click', async () => {
			this.plugin.settings.colourGroups.splice(index, 1);
			await this.plugin.saveSettings();
			this.buildSettingsPanel();
			this.rebuild();
		});
	}

	private buildLegendPanel(): void {
		if (!this.legendPanel) return;
		const panel = this.legendPanel;
		panel.empty();

		panel.createEl('div', { text: 'Legend', cls: 'neighbourhood-graph-panel-heading' });

		const shapes = panel.createDiv({ cls: 'neighbourhood-graph-legend-section' });
		shapes.createEl('div', { text: 'Shapes', cls: 'neighbourhood-graph-panel-subheading' });

		const shapeItems: Array<{ shape: string; label: string; desc: string }> = [
			{ shape: 'circle-large', label: 'Focus note', desc: 'The current note (amber glow)' },
			{ shape: 'circle', label: 'Neighbour note', desc: 'Connected via tags or links' },
			{ shape: 'diamond', label: 'Tag', desc: 'Shared tag between notes' },
			{ shape: 'square', label: 'Backlink target', desc: 'Linked note (no shared tags)' },
		];

		for (const item of shapeItems) {
			const row = shapes.createDiv({ cls: 'neighbourhood-graph-legend-row' });
			row.createDiv({ cls: `neighbourhood-graph-legend-shape ${item.shape}` });
			const text = row.createDiv({ cls: 'neighbourhood-graph-legend-text' });
			text.createEl('strong', { text: item.label });
			text.createEl('span', { text: ` \u2014 ${item.desc}` });
		}

		const interactions = panel.createDiv({ cls: 'neighbourhood-graph-legend-section' });
		interactions.createEl('div', { text: 'Interactions', cls: 'neighbourhood-graph-panel-subheading' });

		const interactionItems: Array<{ action: string; result: string }> = [
			{ action: 'Hover', result: 'Highlight connections' },
			{ action: 'Click', result: 'Recentre graph on that note' },
			{ action: 'Double-click', result: 'Open note in editor' },
			{ action: 'Drag', result: 'Reposition a node' },
			{ action: 'Scroll', result: 'Zoom in/out' },
		];

		for (const item of interactionItems) {
			const row = interactions.createDiv({ cls: 'neighbourhood-graph-legend-row' });
			row.createEl('kbd', { text: item.action, cls: 'neighbourhood-graph-legend-kbd' });
			row.createEl('span', { text: item.result });
		}
	}
}

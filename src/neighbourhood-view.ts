import { ItemView, WorkspaceLeaf, Setting, type TFile, debounce, setIcon } from 'obsidian';
import type NeighbourhoodGraphPlugin from './main';
import { buildNeighbourhood } from './graph-data';
import { GraphRenderer } from './graph-renderer';

export const VIEW_TYPE = 'neighbourhood-graph';

export class NeighbourhoodGraphView extends ItemView {
	private plugin: NeighbourhoodGraphPlugin;
	private renderer: GraphRenderer | null = null;
	private graphContainer: HTMLElement | null = null;
	private settingsPanel: HTMLElement | null = null;
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

		// Graph canvas takes the full space
		this.graphContainer = container.createDiv({ cls: 'neighbourhood-graph-canvas' });

		// Floating control buttons (top-right of canvas)
		const controlBar = this.graphContainer.createDiv({ cls: 'ng-control-bar' });

		const settingsBtn = controlBar.createDiv({ cls: 'ng-control-btn', attr: { 'aria-label': 'Graph settings' } });
		setIcon(settingsBtn, 'settings');
		settingsBtn.addEventListener('click', () => {
			if (this.settingsPanel) {
				const isHidden = this.settingsPanel.hasClass('ng-panel-hidden');
				this.settingsPanel.toggleClass('ng-panel-hidden', !isHidden);
			}
		});

		// Floating settings panel (overlays graph)
		this.settingsPanel = this.graphContainer.createDiv({ cls: 'ng-settings-panel ng-panel-hidden' });
		this.buildSettingsPanel();

		// Draggable, collapsible legend — top-left
		const legend = this.graphContainer.createDiv({ cls: 'ng-legend' });

		const legendHeader = legend.createDiv({ cls: 'ng-legend-header' });
		legendHeader.createSpan({ text: 'Key', cls: 'ng-legend-title' });
		const chevron = legendHeader.createDiv({ cls: 'ng-legend-chevron' });
		setIcon(chevron, 'chevron-down');

		const legendBody = legend.createDiv({ cls: 'ng-legend-body' });
		legendBody.innerHTML = [
			'<span class="ng-legend-item"><span class="ng-shape-circle ng-shape-focus"></span> Focus note</span>',
			'<span class="ng-legend-item"><span class="ng-shape-circle"></span> Neighbour (size = relevance)</span>',
			'<span class="ng-legend-item"><span class="ng-shape-diamond"></span> Shared tag</span>',
			'<div class="ng-legend-divider"></div>',
			'<span class="ng-legend-item">Click = centre on</span>',
			'<span class="ng-legend-item">Double-click = open</span>',
		].join('');

		// Collapse/expand
		let legendCollapsed = false;
		chevron.addEventListener('click', (e) => {
			e.stopPropagation();
			legendCollapsed = !legendCollapsed;
			legendBody.toggleClass('ng-legend-collapsed', legendCollapsed);
			chevron.toggleClass('ng-legend-chevron-collapsed', legendCollapsed);
		});

		// Draggable
		let dragOffsetX = 0;
		let dragOffsetY = 0;
		let isDragging = false;

		legendHeader.addEventListener('mousedown', (e) => {
			if ((e.target as HTMLElement).closest('.ng-legend-chevron')) return;
			isDragging = true;
			const rect = legend.getBoundingClientRect();
			const parentRect = this.graphContainer!.getBoundingClientRect();
			dragOffsetX = e.clientX - (rect.left - parentRect.left);
			dragOffsetY = e.clientY - (rect.top - parentRect.top);
			legend.addClass('ng-legend-dragging');
			e.preventDefault();
		});

		const onMouseMove = (e: MouseEvent): void => {
			if (!isDragging || !this.graphContainer) return;
			const parentRect = this.graphContainer.getBoundingClientRect();
			let x = e.clientX - dragOffsetX;
			let y = e.clientY - dragOffsetY;
			// Clamp within container
			const legendRect = legend.getBoundingClientRect();
			x = Math.max(0, Math.min(x, parentRect.width - legendRect.width));
			y = Math.max(0, Math.min(y, parentRect.height - legendRect.height));
			legend.style.left = `${x}px`;
			legend.style.top = `${y}px`;
			legend.style.right = 'auto';
			legend.style.bottom = 'auto';
		};

		const onMouseUp = (): void => {
			isDragging = false;
			legend.removeClass('ng-legend-dragging');
		};

		this.graphContainer.addEventListener('mousemove', onMouseMove);
		this.graphContainer.addEventListener('mouseup', onMouseUp);

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

		// Remove truncation indicator from previous render
		const oldTruncated = this.graphContainer.querySelector('.ng-truncated');
		if (oldTruncated) oldTruncated.remove();

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

		if (data.truncated) {
			const indicator = this.graphContainer.createDiv({ cls: 'ng-truncated' });
			indicator.setText(`${data.truncated} more notes not shown`);
		}
	}

	private buildSettingsPanel(): void {
		if (!this.settingsPanel) return;
		const panel = this.settingsPanel;
		panel.empty();

		// Depth
		new Setting(panel)
			.setName('Highlight depth')
			.setDesc('Hover highlight tiers')
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
			.setDesc('Most connected shown first')
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.style.width = '60px';
				return text
					.setValue(String(this.plugin.settings.maxNeighbours))
					.onChange(async (val) => {
						const num = parseInt(val, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxNeighbours = num;
							await this.plugin.saveSettings();
							this.rebuild();
						}
					});
			});

		// Show path
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
		panel.createEl('div', { text: 'Physics', cls: 'ng-section-label' });

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

		const grid = panel.createDiv({ cls: 'ng-slider-grid' });
		for (const s of sliders) {
			const wrapper = grid.createDiv({ cls: 'ng-slider-wrapper' });
			wrapper.createEl('label', { text: s.label, cls: 'ng-slider-label' });
			const input = wrapper.createEl('input', { type: 'range', cls: 'ng-slider' });
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
		panel.createEl('div', { text: 'Colours', cls: 'ng-section-label' });

		new Setting(panel)
			.setName('Default node')
			.addColorPicker((picker) =>
				picker.setValue(this.plugin.settings.defaultNodeColour)
					.onChange(async (val) => {
						this.plugin.settings.defaultNodeColour = val;
						await this.plugin.saveSettings();
						this.rebuild();
					}),
			);

		new Setting(panel)
			.setName('Tag concept')
			.addColorPicker((picker) =>
				picker.setValue(this.plugin.settings.tagConceptColour)
					.onChange(async (val) => {
						this.plugin.settings.tagConceptColour = val;
						await this.plugin.saveSettings();
						this.rebuild();
					}),
			);

		// Colour groups
		panel.createEl('div', { text: 'Colour groups', cls: 'ng-section-label' });
		panel.createEl('p', {
			text: '"path:folder/", "tag:#name", or text. First match wins.',
			cls: 'ng-panel-hint',
		});

		const groupsContainer = panel.createDiv();
		for (let i = 0; i < this.plugin.settings.colourGroups.length; i++) {
			this.renderColourGroupRow(groupsContainer, i);
		}

		const addBtn = panel.createEl('button', { text: '+ Add group', cls: 'ng-add-group-btn' });
		addBtn.addEventListener('click', async () => {
			this.plugin.settings.colourGroups.push({ query: '', colour: '#6b7280' });
			await this.plugin.saveSettings();
			this.buildSettingsPanel();
		});
	}

	private renderColourGroupRow(container: HTMLElement, index: number): void {
		const group = this.plugin.settings.colourGroups[index];
		const row = container.createDiv({ cls: 'ng-group-row' });

		const queryInput = row.createEl('input', {
			type: 'text',
			cls: 'ng-group-query',
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
			cls: 'ng-group-colour',
			value: group.colour,
		});
		colourInput.addEventListener('input', async () => {
			this.plugin.settings.colourGroups[index].colour = colourInput.value;
			await this.plugin.saveSettings();
			this.rebuild();
		});

		const removeBtn = row.createEl('button', { cls: 'ng-group-remove', text: '\u00d7' });
		removeBtn.addEventListener('click', async () => {
			this.plugin.settings.colourGroups.splice(index, 1);
			await this.plugin.saveSettings();
			this.buildSettingsPanel();
			this.rebuild();
		});
	}
}

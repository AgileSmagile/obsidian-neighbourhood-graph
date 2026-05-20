import { ItemView, WorkspaceLeaf, Setting, Notice, type TFile, debounce, setIcon } from 'obsidian';
import type NeighbourhoodGraphPlugin from './main';
import { buildNeighbourhood } from './graph-data';
import { GraphRenderer } from './graph-renderer';
import { loadExcalibrainConfig, buildFieldLookup } from './excalibrain';
import type { EdgeRelationType } from './types';

export const VIEW_TYPE = 'neighbourhood-graph';

export class NeighbourhoodGraphView extends ItemView {
	private plugin: NeighbourhoodGraphPlugin;
	private renderer: GraphRenderer | null = null;
	private graphContainer: HTMLElement | null = null;
	private settingsPanel: HTMLElement | null = null;
	private focusFile: TFile | null = null;
	private excalibrainFields: Map<string, EdgeRelationType> | null = null;

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
		return 'neighbourhood-graph-icon';
	}

	async onOpen(): Promise<void> {
		await this.refreshExcalibrainFields();

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
		const legendItems: Array<{ shape?: string; text: string }> = [
			{ shape: 'ng-shape-circle ng-shape-focus', text: 'Focus note' },
			{ shape: 'ng-shape-circle', text: 'Neighbour (size = relevance)' },
			{ shape: 'ng-shape-diamond', text: 'Shared tag' },
		];
		for (const item of legendItems) {
			const row = legendBody.createSpan({ cls: 'ng-legend-item' });
			if (item.shape) row.createSpan({ cls: item.shape });
			row.appendText(` ${item.text}`);
		}
		if (this.excalibrainFields) {
			legendBody.createDiv({ cls: 'ng-legend-divider' });
			const edgeHints: Array<{ cls: string; text: string }> = [
				{ cls: 'ng-edge-solid', text: 'Parent / child' },
				{ cls: 'ng-edge-dashed', text: 'Friend' },
				{ cls: 'ng-edge-dotted', text: 'Opposes' },
				{ cls: 'ng-edge-dashdot', text: 'Previous / next' },
			];
			for (const hint of edgeHints) {
				const row = legendBody.createSpan({ cls: 'ng-legend-item' });
				row.createSpan({ cls: hint.cls });
				row.appendText(` ${hint.text}`);
			}
		}

		legendBody.createDiv({ cls: 'ng-legend-divider' });
		for (const hint of ['Click = centre on', 'Double-click = open']) {
			legendBody.createSpan({ cls: 'ng-legend-item', text: hint });
		}

		// Collapse/expand
		let legendCollapsed = false;
		chevron.addEventListener('click', (e) => {
			e.stopPropagation();
			legendCollapsed = !legendCollapsed;
			legendBody.toggleClass('ng-legend-collapsed', legendCollapsed);
			chevron.toggleClass('ng-legend-chevron-collapsed', legendCollapsed);
			legend.toggleClass('ng-legend-is-collapsed', legendCollapsed);
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

	onSettingsChanged(): void {
		void this.reloadAndRebuild();
	}

	private async reloadAndRebuild(): Promise<void> {
		await this.refreshExcalibrainFields();
		this.buildSettingsPanel();
		this.rebuild();
	}

	private async refreshExcalibrainFields(): Promise<void> {
		if (!this.plugin.settings.excalibrainEnabled) {
			this.excalibrainFields = null;
			return;
		}
		const config = await loadExcalibrainConfig(this.app);
		this.excalibrainFields = config ? buildFieldLookup(config) : null;
	}

	recentreOn(filePath: string): void {
		const file = this.app.vault.getFileByPath(filePath);
		if (!file) return;
		this.focusFile = file;
		this.rebuild();
	}

	private rebuild(): void {
		if (!this.focusFile || !this.graphContainer) return;

		const data = buildNeighbourhood(this.focusFile, this.app, this.plugin.settings, this.excalibrainFields);

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
		this.addSettingWithInfo(panel, 'Highlight depth',
			'How many tiers of connections light up when you hover a node. 1 = direct connections only. 2 = also highlights connections of connections.',
			(s) => s.addDropdown((drop) =>
				drop
					.addOption('1', '1 hop')
					.addOption('2', '2 hops')
					.setValue(String(this.plugin.settings.depth))
					.onChange(async (val) => {
						this.plugin.settings.depth = Number(val) as 1 | 2;
						await this.plugin.saveSettings();
					}),
			));

		this.addSettingWithInfo(panel, 'Max neighbours',
			'Maximum notes shown around the focus note. The most strongly connected neighbours are shown first.',
			(s) => s.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.style.width = '60px';
				return text
					.setValue(String(this.plugin.settings.maxNeighbours))
					.onChange(async (val) => {
						const num = parseInt(val, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxNeighbours = num;
							await this.plugin.saveSettings();
						}
					});
			}));

		// Display section
		panel.createEl('div', { text: 'Display', cls: 'ng-section-label' });

		const salienceWrapper = panel.createDiv({ cls: 'ng-slider-wrapper' });
		const salienceLabelRow = salienceWrapper.createDiv({ cls: 'ng-label-row' });
		salienceLabelRow.createEl('label', { text: 'Size by relevance', cls: 'ng-slider-label' });
		const salienceInfo = salienceLabelRow.createEl('span', { cls: 'ng-info-icon', attr: {
			'aria-label': 'Scales node size by how strongly connected a neighbour is. More shared tags and links = bigger node. 0 = all same size. 10 = maximum variation.',
		}});
		setIcon(salienceInfo, 'info');
		const salienceInput = salienceWrapper.createEl('input', { type: 'range', cls: 'ng-slider' });
		salienceInput.min = '0';
		salienceInput.max = '10';
		salienceInput.value = String(this.plugin.settings.salienceImpact);
		salienceInput.addEventListener('input', async () => {
			this.plugin.settings.salienceImpact = Number(salienceInput.value);
			await this.plugin.saveSettings();
		});

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
		const updatePhysicsSetting = (key: 'lineColour' | 'lineThickness' | 'spread' | 'linkPull', val: number): void => {
			this.plugin.settings[key] = val;
			this.plugin.saveSettings();
			if (this.renderer) this.renderer.updateSlider(key, val);
		};
		for (const s of sliders) {
			const wrapper = grid.createDiv({ cls: 'ng-slider-wrapper' });
			wrapper.createEl('label', { text: s.label, cls: 'ng-slider-label' });
			const input = wrapper.createEl('input', { type: 'range', cls: 'ng-slider' });
			input.min = String(s.min);
			input.max = String(s.max);
			input.value = String(this.plugin.settings[s.key]);

			const key = s.key;
			input.addEventListener('input', () => {
				updatePhysicsSetting(key, Number(input.value));
			});
		}

		// Content & display — signpost to plugin settings
		panel.createEl('div', { text: 'Content & display', cls: 'ng-section-label' });
		panel.createEl('p', {
			text: 'Colour groups, tooltip options, and Excalibrain integration are in plugin settings.',
			cls: 'ng-panel-hint',
		});

		const btnRow = panel.createDiv({ cls: 'ng-btn-row' });

		const importBtn = btnRow.createEl('button', { text: 'Import colours', cls: 'ng-import-btn' });
		importBtn.addEventListener('click', async () => {
			await this.importColourGroups();
		});

		const settingsBtn = btnRow.createEl('button', { text: 'Open settings', cls: 'ng-import-btn' });
		settingsBtn.addEventListener('click', () => {
			const appSetting = (this.app as unknown as Record<string, unknown>).setting as
				{ open(): void; openTabById(id: string): void } | undefined;
			if (appSetting) {
				appSetting.open();
				appSetting.openTabById('neighbourhood-graph');
			}
		});
	}

	private addSettingWithInfo(
		container: HTMLElement,
		name: string,
		tooltip: string,
		configure: (s: Setting) => void,
	): void {
		const setting = new Setting(container).setName(name);
		// Add info icon with hover tooltip after the name
		const nameEl = setting.nameEl;
		const info = nameEl.createEl('span', { cls: 'ng-info-icon', attr: { 'aria-label': tooltip } });
		setIcon(info, 'info');
		configure(setting);
	}

	private async importColourGroups(): Promise<void> {
		try {
			const configPath = `${this.app.vault.configDir}/graph.json`;
			const exists = await this.app.vault.adapter.exists(configPath);
			if (!exists) {
				new Notice('No graph.json found. Open Obsidian\'s graph view and configure colour groups first.');
				return;
			}
			const raw = await this.app.vault.adapter.read(configPath);
			const config = JSON.parse(raw);
			if (!config.colorGroups || config.colorGroups.length === 0) {
				new Notice('No colour groups found in Obsidian\'s graph view settings.');
				return;
			}
			this.plugin.settings.colourGroups = config.colorGroups.map((g: { query: string; color: { rgb: number } }) => ({
				query: g.query.trim(),
				colour: `#${g.color.rgb.toString(16).padStart(6, '0')}`,
			}));
			await this.plugin.saveSettings();
			this.buildSettingsPanel();
			this.rebuild();
			new Notice(`Imported ${this.plugin.settings.colourGroups.length} colour groups from graph view.`);
		} catch {
			new Notice('Failed to read graph view settings.');
		}
	}
}

import { PluginSettingTab, Setting, App, Notice, setIcon, ButtonComponent } from 'obsidian';
import type NeighbourhoodGraphPlugin from './main';
import type { ColourGroup } from './types';
import { getExcalibrainState } from './excalibrain';

const EXCALIBRAIN_PLUGIN_URL = 'https://obsidian.md/plugins?id=excalibrain';

interface ObsidianGraphConfig {
	colorGroups?: Array<{
		query: string;
		color: { a: number; rgb: number };
	}>;
}

function obsidianRgbToHex(rgb: number): string {
	return `#${rgb.toString(16).padStart(6, '0')}`;
}

export class NeighbourhoodGraphSettingTab extends PluginSettingTab {
	plugin: NeighbourhoodGraphPlugin;
	/** Persists collapse state across re-renders triggered by add/remove/reorder */
	private _groupsCollapsed: boolean | null = null;

	constructor(app: App, plugin: NeighbourhoodGraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.containerEl.empty();

		// --- Graph behaviour ---
		this.containerEl.createEl('h3', { text: 'Graph behaviour' });

		new Setting(this.containerEl)
			.setName('Highlight depth')
			.setDesc('How many tiers of connections light up when you hover a node. 1 hop highlights only direct connections. 2 hops also highlights connections of connections.')
			.addDropdown((drop) =>
				drop
					.addOption('1', '1 hop')
					.addOption('2', '2 hops')
					.setValue(String(this.plugin.settings.depth))
					.onChange(async (val) => {
						this.plugin.settings.depth = Number(val) as 1 | 2;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(this.containerEl)
			.setName('Max neighbours')
			.setDesc('Maximum number of notes shown around the focus note. The most strongly connected neighbours are shown first.')
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
						}
					});
			});

		// --- Display ---
		this.containerEl.createEl('h3', { text: 'Display' });

		new Setting(this.containerEl)
			.setName('Max node size')
			.setDesc('Maximum radius (px) of the largest neighbour node. Reduce for a compact sidebar; increase for a full-panel view. Default 10 is optimised for a narrow sidebar.')
			.addSlider((slider) =>
				slider
					.setLimits(4, 20, 1)
					.setValue(this.plugin.settings.maxNodeSize)
					.setDynamicTooltip()
					.onChange(async (val) => {
						this.plugin.settings.maxNodeSize = val;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(this.containerEl)
			.setName('Show path in tooltip')
			.setDesc('When hovering a note node, show its vault-relative folder path below the title. Useful for distinguishing notes with similar names.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showPathInTooltip)
					.onChange(async (val) => {
						this.plugin.settings.showPathInTooltip = val;
						await this.plugin.saveSettings();
					}),
			);

		// --- Colour groups ---
		this.containerEl.createEl('h3', { text: 'Colour groups' });

		new Setting(this.containerEl)
			.setName('Default node colour')
			.setDesc('Notes not matching any group use this colour. Defaults to your theme\'s accent colour.')
			.addColorPicker((picker) =>
				picker.setValue(this.plugin.settings.defaultNodeColour)
					.onChange(async (val) => {
						this.plugin.settings.defaultNodeColour = val;
						await this.plugin.saveSettings();
					}),
			);

		this.containerEl.createEl('p', {
			text: 'Assign colours to notes by query. Supported: "path:folder/", "tag:#name", or plain text matching note title. First matching rule wins.',
			cls: 'setting-item-description',
		});

		// Import row — icon button only, less prominent than a labelled button
		const importRow = this.containerEl.createDiv({ cls: 'ng-import-row' });
		importRow.createSpan({ text: 'Import from Obsidian graph view', cls: 'ng-import-label' });
		const importIconBtn = new ButtonComponent(importRow);
		importIconBtn
			.setIcon('arrow-down-to-line')
			.setTooltip('Import colour groups from Obsidian\'s built-in graph view')
			.setClass('ng-icon-btn')
			.onClick(async () => { await this.importFromGraphView(); });

		// Collapsible group list
		const groupCount = this.plugin.settings.colourGroups.length;
		if (this._groupsCollapsed === null) {
			// Default: collapsed when groups already exist, open when empty
			this._groupsCollapsed = groupCount > 0;
		}

		const disclosureRow = this.containerEl.createDiv({ cls: 'ng-disclosure-row' });
		const chevron = disclosureRow.createSpan({ cls: 'ng-disclosure-chevron' });
		setIcon(chevron, 'chevron-down');
		const countLabel = disclosureRow.createSpan({
			text: groupCount === 0 ? 'No groups — add one below' : `${groupCount} group${groupCount === 1 ? '' : 's'}`,
			cls: 'ng-disclosure-label',
		});

		const groupsBody = this.containerEl.createDiv({ cls: 'ng-disclosure-body' });

		// Apply initial collapsed state
		if (this._groupsCollapsed) {
			groupsBody.addClass('ng-disclosure-collapsed');
			chevron.addClass('ng-chevron-collapsed');
		}

		disclosureRow.addEventListener('click', () => {
			this._groupsCollapsed = !this._groupsCollapsed;
			groupsBody.toggleClass('ng-disclosure-collapsed', this._groupsCollapsed!);
			chevron.toggleClass('ng-chevron-collapsed', this._groupsCollapsed!);
		});

		for (let i = 0; i < this.plugin.settings.colourGroups.length; i++) {
			this.renderColourGroup(groupsBody, i);
		}

		new Setting(groupsBody)
			.addButton((btn) =>
				btn.setButtonText('Add group').onClick(async () => {
					this._groupsCollapsed = false; // expand on add so user sees the new row
					this.plugin.settings.colourGroups.push({ query: '', colour: '#6b7280' });
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		// --- Excalibrain integration ---
		this.containerEl.createEl('h3', { text: 'Excalibrain integration' });

		const excaliContainer = this.containerEl.createDiv();
		void this.renderExcalibrainSection(excaliContainer);
	}

	private async renderExcalibrainSection(container: HTMLElement): Promise<void> {
		const state = await getExcalibrainState(this.app);

		if (state === 'not-installed') {
			const statusRow = container.createDiv({ cls: 'ng-excali-status ng-excali-missing' });
			const icon = statusRow.createSpan({ cls: 'ng-excali-status-icon' });
			setIcon(icon, 'info');
			statusRow.createSpan({ text: 'Excalibrain is not installed' });

			const desc = container.createEl('p', { cls: 'setting-item-description' });
			desc.appendText('When Excalibrain is installed, this plugin reads its typed relationship fields (parent, child, friend, opposes, etc.) to draw distinct edge styles and weight connections more accurately. ');
			const link = desc.createEl('a', { text: 'Get Excalibrain →', href: EXCALIBRAIN_PLUGIN_URL });
			link.setAttr('target', '_blank');
			link.setAttr('rel', 'noopener');

		} else if (state === 'installed-unconfigured') {
			const statusRow = container.createDiv({ cls: 'ng-excali-status ng-excali-pending' });
			const icon = statusRow.createSpan({ cls: 'ng-excali-status-icon' });
			setIcon(icon, 'clock');
			statusRow.createSpan({ text: 'Excalibrain installed — using default fields' });

			container.createEl('p', {
				text: 'Excalibrain hasn\'t been opened yet so it has no saved configuration. This plugin is currently using Excalibrain\'s built-in English field names (Parent, Children, Friends, etc.). Open Excalibrain to generate its config and customise which fields map to which relationship types.',
				cls: 'setting-item-description',
			});

			new Setting(container)
				.setName('Use Excalibrain relationships')
				.setDesc('Edges where source or target note has a matching frontmatter field will be styled distinctly and ranked higher.')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.excalibrainEnabled)
						.onChange(async (val) => {
							this.plugin.settings.excalibrainEnabled = val;
							await this.plugin.saveSettings();
						}),
				);

		} else {
			const statusRow = container.createDiv({ cls: 'ng-excali-status ng-excali-found' });
			const icon = statusRow.createSpan({ cls: 'ng-excali-status-icon' });
			setIcon(icon, 'check-circle');
			statusRow.createSpan({ text: 'Excalibrain installed and configured' });

			container.createEl('p', {
				text: 'Relationship fields from your Excalibrain configuration are active. Edges typed as parent/child draw as solid lines, friends as dashed, opposes as dotted, previous/next as dash-dot. Typed links also receive a strength bonus so they rank higher in the neighbourhood.',
				cls: 'setting-item-description',
			});

			new Setting(container)
				.setName('Use Excalibrain relationships')
				.setDesc('Read Excalibrain relationship fields to type edges and boost connection strength.')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.excalibrainEnabled)
						.onChange(async (val) => {
							this.plugin.settings.excalibrainEnabled = val;
							await this.plugin.saveSettings();
						}),
				);
		}
	}

	private renderColourGroup(container: HTMLElement, index: number): void {
		const group = this.plugin.settings.colourGroups[index];

		const setting = new Setting(container)
			.addText((text) =>
				text
					.setPlaceholder('e.g. path:people/')
					.setValue(group.query)
					.onChange(async (val) => {
						this.plugin.settings.colourGroups[index].query = val;
						await this.plugin.saveSettings();
					}),
			)
			.addColorPicker((picker) =>
				picker
					.setValue(group.colour)
					.onChange(async (val) => {
						this.plugin.settings.colourGroups[index].colour = val;
						await this.plugin.saveSettings();
					}),
			)
			.addExtraButton((btn) =>
				btn.setIcon('trash').setTooltip('Remove group').onClick(async () => {
					this.plugin.settings.colourGroups.splice(index, 1);
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		if (index > 0) {
			setting.addExtraButton((btn) =>
				btn.setIcon('arrow-up').setTooltip('Move up').onClick(async () => {
					const groups = this.plugin.settings.colourGroups;
					[groups[index - 1], groups[index]] = [groups[index], groups[index - 1]];
					await this.plugin.saveSettings();
					this.display();
				}),
			);
		}

		if (index < this.plugin.settings.colourGroups.length - 1) {
			setting.addExtraButton((btn) =>
				btn.setIcon('arrow-down').setTooltip('Move down').onClick(async () => {
					const groups = this.plugin.settings.colourGroups;
					[groups[index], groups[index + 1]] = [groups[index + 1], groups[index]];
					await this.plugin.saveSettings();
					this.display();
				}),
			);
		}
	}

	private async importFromGraphView(): Promise<void> {
		try {
			const configPath = `${this.app.vault.configDir}/graph.json`;
			const exists = await this.app.vault.adapter.exists(configPath);
			if (!exists) {
				new Notice('No graph.json found. Open Obsidian\'s graph view and configure colour groups first.');
				return;
			}

			const raw = await this.app.vault.adapter.read(configPath);
			const config: ObsidianGraphConfig = JSON.parse(raw);

			if (!config.colorGroups || config.colorGroups.length === 0) {
				new Notice('No colour groups found in Obsidian\'s graph view settings.');
				return;
			}

			const imported: ColourGroup[] = config.colorGroups.map((g) => ({
				query: g.query.trim(),
				colour: obsidianRgbToHex(g.color.rgb),
			}));

			this.plugin.settings.colourGroups = imported;
			await this.plugin.saveSettings();
			this.display();

			new Notice(`Imported ${imported.length} colour group${imported.length === 1 ? '' : 's'} from graph view.`);
		} catch (e) {
			console.warn('[neighbourhood-graph] Failed to import graph colours:', e);
			new Notice('Failed to read graph view settings.');
		}
	}
}

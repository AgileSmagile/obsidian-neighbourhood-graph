import { PluginSettingTab, Setting, App, Notice } from 'obsidian';
import type NeighbourhoodGraphPlugin from './main';
import type { ColourGroup } from './types';

interface ObsidianGraphConfig {
	colorGroups?: Array<{
		query: string;
		color: { a: number; rgb: number };
	}>;
}

function obsidianRgbToHex(rgb: number): string {
	const hex = rgb.toString(16).padStart(6, '0');
	return `#${hex}`;
}

export class NeighbourhoodGraphSettingTab extends PluginSettingTab {
	plugin: NeighbourhoodGraphPlugin;

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
			.setDesc('Maximum number of notes shown around the focus note. The most strongly connected neighbours are shown first. Lower values keep the graph readable; raise it for well-connected vaults.')
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
			.setDesc('Notes not matching any group use this colour. Set to your theme\'s accent by default.')
			.addColorPicker((picker) =>
				picker.setValue(this.plugin.settings.defaultNodeColour)
					.onChange(async (val) => {
						this.plugin.settings.defaultNodeColour = val;
						await this.plugin.saveSettings();
					}),
			);

		this.containerEl.createEl('p', {
			text: 'Assign colours to notes by query. Supported queries: "path:folder/", "tag:#name", or plain text (matches note title). First matching rule wins.',
			cls: 'setting-item-description',
		});

		// Import from Obsidian graph button
		new Setting(this.containerEl)
			.setName('Import from graph view')
			.setDesc('Copy colour groups from Obsidian\'s built-in graph view settings')
			.addButton((btn) =>
				btn.setButtonText('Import').onClick(async () => {
					await this.importFromGraphView();
				}),
			);

		// Existing groups
		for (let i = 0; i < this.plugin.settings.colourGroups.length; i++) {
			this.renderColourGroup(this.containerEl, i);
		}

		new Setting(this.containerEl)
			.addButton((btn) =>
				btn.setButtonText('Add group').onClick(async () => {
					this.plugin.settings.colourGroups.push({ query: '', colour: '#6b7280' });
					await this.plugin.saveSettings();
					this.display();
				}),
			);
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

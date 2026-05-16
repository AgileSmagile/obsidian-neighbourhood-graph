import { PluginSettingTab, Setting, App } from 'obsidian';
import type NeighbourhoodGraphPlugin from './main';
import type { ColourGroup } from './types';

export class NeighbourhoodGraphSettingTab extends PluginSettingTab {
	plugin: NeighbourhoodGraphPlugin;

	constructor(app: App, plugin: NeighbourhoodGraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Neighbourhood depth')
			.setDesc('How many hops from the focus note')
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

		new Setting(containerEl)
			.setName('Max neighbours')
			.setDesc('Cap to prevent overwhelming graphs')
			.addText((text) =>
				text
					.setValue(String(this.plugin.settings.maxNeighbours))
					.onChange(async (val) => {
						const num = parseInt(val, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxNeighbours = num;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(containerEl)
			.setName('Show path in tooltip')
			.setDesc('Display the vault-relative folder path in node tooltips')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showPathInTooltip)
					.onChange(async (val) => {
						this.plugin.settings.showPathInTooltip = val;
						await this.plugin.saveSettings();
					}),
			);

		// Colour settings
		containerEl.createEl('h3', { text: 'Colours' });

		new Setting(containerEl)
			.setName('Default node colour')
			.setDesc('For notes not matching any group')
			.addColorPicker((picker) =>
				picker
					.setValue(this.plugin.settings.defaultNodeColour)
					.onChange(async (val) => {
						this.plugin.settings.defaultNodeColour = val;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Tag concept colour')
			.setDesc('Diamond-shaped tag nodes')
			.addColorPicker((picker) =>
				picker
					.setValue(this.plugin.settings.tagConceptColour)
					.onChange(async (val) => {
						this.plugin.settings.tagConceptColour = val;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Backlink concept colour')
			.setDesc('Square-shaped backlink target nodes')
			.addColorPicker((picker) =>
				picker
					.setValue(this.plugin.settings.backlinkConceptColour)
					.onChange(async (val) => {
						this.plugin.settings.backlinkConceptColour = val;
						await this.plugin.saveSettings();
					}),
			);

		// Colour groups
		containerEl.createEl('h3', { text: 'Colour groups' });
		containerEl.createEl('p', {
			text: 'Define query-colour pairs. Queries: "path:folder/", "tag:#name", or plain text (matches note title). First match wins.',
			cls: 'setting-item-description',
		});

		for (let i = 0; i < this.plugin.settings.colourGroups.length; i++) {
			this.renderColourGroup(containerEl, i);
		}

		new Setting(containerEl)
			.addButton((btn) =>
				btn
					.setButtonText('Add group')
					.onClick(async () => {
						this.plugin.settings.colourGroups.push({ query: '', colour: '#6b7280' });
						await this.plugin.saveSettings();
						this.display();
					}),
			);
	}

	private renderColourGroup(containerEl: HTMLElement, index: number): void {
		const group = this.plugin.settings.colourGroups[index];

		const setting = new Setting(containerEl)
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
				btn
					.setIcon('trash')
					.setTooltip('Remove group')
					.onClick(async () => {
						this.plugin.settings.colourGroups.splice(index, 1);
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		// Move up/down buttons for reordering
		if (index > 0) {
			setting.addExtraButton((btn) =>
				btn
					.setIcon('arrow-up')
					.setTooltip('Move up')
					.onClick(async () => {
						const groups = this.plugin.settings.colourGroups;
						[groups[index - 1], groups[index]] = [groups[index], groups[index - 1]];
						await this.plugin.saveSettings();
						this.display();
					}),
			);
		}
		if (index < this.plugin.settings.colourGroups.length - 1) {
			setting.addExtraButton((btn) =>
				btn
					.setIcon('arrow-down')
					.setTooltip('Move down')
					.onClick(async () => {
						const groups = this.plugin.settings.colourGroups;
						[groups[index], groups[index + 1]] = [groups[index + 1], groups[index]];
						await this.plugin.saveSettings();
						this.display();
					}),
			);
		}
	}
}

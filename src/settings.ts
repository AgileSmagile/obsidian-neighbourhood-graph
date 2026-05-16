import { PluginSettingTab, Setting, App } from 'obsidian';
import type NeighbourhoodGraphPlugin from './main';

export class NeighbourhoodGraphSettingTab extends PluginSettingTab {
	plugin: NeighbourhoodGraphPlugin;

	constructor(app: App, plugin: NeighbourhoodGraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('p', {
			text: 'Most settings are available directly in the graph sidebar panel via the gear icon.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Highlight depth')
			.setDesc('Tiers of connection prominence shown on hover. 1 = direct connections only. 2 = direct + secondary.')
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
			.setDesc('Maximum number of neighbour notes shown in the graph')
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
	}
}

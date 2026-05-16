import { Plugin } from 'obsidian';
import { NeighbourhoodGraphView, VIEW_TYPE } from './neighbourhood-view';
import { NeighbourhoodGraphSettingTab } from './settings';
import { DEFAULT_SETTINGS } from './types';
import type { NeighbourhoodGraphSettings } from './types';

export default class NeighbourhoodGraphPlugin extends Plugin {
	settings: NeighbourhoodGraphSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE,
			(leaf) => new NeighbourhoodGraphView(leaf, this),
		);

		this.addRibbonIcon('git-fork', 'Open neighbourhood graph', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-neighbourhood-graph',
			name: 'Open neighbourhood graph',
			callback: () => this.activateView(),
		});

		this.addSettingTab(new NeighbourhoodGraphSettingTab(this.app, this));

		console.debug('[neighbourhood-graph] loaded');
	}

	onunload(): void {
		console.debug('[neighbourhood-graph] unloaded');
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	private async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}
}

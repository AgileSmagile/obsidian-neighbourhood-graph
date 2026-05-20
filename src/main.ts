import { Plugin, addIcon } from 'obsidian';

const NG_ICON_ID = 'neighbourhood-graph-icon';
// Scope + 3 satellites — coordinates in 0 0 100 100 space (Obsidian addIcon viewBox)
// Original 24×24 design scaled ×4.167
const NG_ICON_SVG = `<circle cx="50" cy="50" r="43.8" fill="none" stroke="currentColor" stroke-width="5" stroke-opacity="0.65" stroke-linecap="round"/>
<line x1="50" y1="2.1" x2="50" y2="8.3"   stroke="currentColor" stroke-width="5.4" stroke-linecap="round"/>
<line x1="50" y1="91.7" x2="50" y2="97.9"  stroke="currentColor" stroke-width="5.4" stroke-linecap="round"/>
<line x1="2.1" y1="50" x2="8.3"  y2="50"   stroke="currentColor" stroke-width="5.4" stroke-linecap="round"/>
<line x1="91.7" y1="50" x2="97.9" y2="50"  stroke="currentColor" stroke-width="5.4" stroke-linecap="round"/>
<circle cx="50"  cy="50"   r="8.3" fill="none" stroke="currentColor" stroke-width="6.7" stroke-linecap="round"/>
<circle cx="50"  cy="20.8" r="5.4" fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round"/>
<circle cx="24.6" cy="64.6" r="5.4" fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round"/>
<circle cx="75.4" cy="64.6" r="5.4" fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round"/>
<line x1="50"  y1="41.7" x2="50"  y2="26.3" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"/>
<line x1="42.9" y1="54.2" x2="29.6" y2="61.7" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"/>
<line x1="57.1" y1="54.2" x2="70.4" y2="61.7" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"/>
<line x1="30"  y1="64.6" x2="70"  y2="64.6" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"/>`;
import { NeighbourhoodGraphView, VIEW_TYPE } from './neighbourhood-view';
import { NeighbourhoodGraphSettingTab } from './settings';
import { DEFAULT_SETTINGS } from './types';
import type { NeighbourhoodGraphSettings } from './types';

export default class NeighbourhoodGraphPlugin extends Plugin {
	settings: NeighbourhoodGraphSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();
		addIcon(NG_ICON_ID, NG_ICON_SVG);

		this.registerView(
			VIEW_TYPE,
			(leaf) => new NeighbourhoodGraphView(leaf, this),
		);

		this.addRibbonIcon(NG_ICON_ID, 'Open neighbourhood graph', () => {
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

	/** Persist settings without notifying views — use for sliders that update live via other means */
	async saveSettingsOnly(): Promise<void> {
		await this.saveData(this.settings);
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Notify any open graph views to rebuild with new settings
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
			if (leaf.view instanceof NeighbourhoodGraphView) {
				(leaf.view as NeighbourhoodGraphView).onSettingsChanged();
			}
		}
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

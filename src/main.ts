import { Plugin, addIcon } from 'obsidian';

const NG_ICON_ID = 'neighbourhood-graph-icon';
// Scope + 3 satellites: reticle ring with focus node, 3 neighbours at ring edge, one neighbour-to-neighbour link
const NG_ICON_SVG = `<circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-opacity="0.65" stroke-linecap="round"/>
<line x1="12" y1="0.5" x2="12" y2="2"    stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
<line x1="12" y1="22"  x2="12" y2="23.5"  stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
<line x1="0.5" y1="12" x2="2"   y2="12"   stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
<line x1="22"  y1="12" x2="23.5" y2="12"  stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
<circle cx="12"   cy="12"   r="2"   fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
<circle cx="12"   cy="5"    r="1.3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
<circle cx="5.9"  cy="15.5" r="1.3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
<circle cx="18.1" cy="15.5" r="1.3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
<line x1="12"   y1="10"   x2="12"   y2="6.3"  stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/>
<line x1="10.3" y1="13.0" x2="7.1"  y2="14.8" stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/>
<line x1="13.7" y1="13.0" x2="16.9" y2="14.8" stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/>
<line x1="7.2"  y1="15.5" x2="16.8" y2="15.5" stroke="currentColor" stroke-width="1.0" stroke-linecap="round"/>`;
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

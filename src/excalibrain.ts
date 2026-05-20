import type { App } from 'obsidian';
import type { EdgeRelationType, ExcalibrainConfig } from './types';

/**
 * Excalibrain's built-in English defaults.
 * Used when the plugin is installed but data.json doesn't exist yet
 * (i.e. it has never been opened/configured).
 */
const EXCALIBRAIN_DEFAULTS: ExcalibrainConfig = {
	parents:      ['Parent', 'Parents', 'up', 'North', 'origin', 'inception', 'source'],
	children:     ['Children', 'Child', 'down', 'South', 'leads to', 'contributes to', 'nurtures'],
	leftFriends:  ['Friends', 'Friend', 'similar', 'supports', 'alternatives', 'pros'],
	rightFriends: ['opposes', 'disadvantages', 'cons'],
	previous:     ['Previous', 'Prev', 'Before'],
	next:         ['Next', 'After'],
};

export type ExcalibrainInstallState = 'not-installed' | 'installed-unconfigured' | 'configured';

export async function getExcalibrainState(app: App): Promise<ExcalibrainInstallState> {
	const mainJs  = `${app.vault.configDir}/plugins/excalibrain/main.js`;
	const dataJson = `${app.vault.configDir}/plugins/excalibrain/data.json`;
	if (!(await app.vault.adapter.exists(mainJs))) return 'not-installed';
	if (!(await app.vault.adapter.exists(dataJson))) return 'installed-unconfigured';
	return 'configured';
}

/**
 * Attempt to load Excalibrain's saved configuration.
 * Falls back to built-in English defaults when the plugin is installed but
 * data.json doesn't exist yet (never been opened). Returns null only when
 * the plugin is not installed at all.
 */
export async function loadExcalibrainConfig(app: App): Promise<ExcalibrainConfig | null> {
	const mainJs   = `${app.vault.configDir}/plugins/excalibrain/main.js`;
	const dataJson = `${app.vault.configDir}/plugins/excalibrain/data.json`;

	if (!(await app.vault.adapter.exists(mainJs))) return null;

	try {
		if (!(await app.vault.adapter.exists(dataJson))) {
			// Installed but not yet configured — use built-in defaults
			return EXCALIBRAIN_DEFAULTS;
		}
		const raw  = await app.vault.adapter.read(dataJson);
		const data = JSON.parse(raw);
		return {
			parents:      toStringArray(data.parents),
			children:     toStringArray(data.children),
			leftFriends:  toStringArray(data.leftFriends),
			rightFriends: toStringArray(data.rightFriends),
			previous:     toStringArray(data.previous),
			next:         toStringArray(data.next),
		};
	} catch {
		return EXCALIBRAIN_DEFAULTS;
	}
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter((v): v is string => typeof v === 'string');
}

/**
 * Build a lookup map from lowercase frontmatter field name → relationship type.
 * Used at match time so we only pay the cost once per graph build.
 */
export function buildFieldLookup(config: ExcalibrainConfig): Map<string, EdgeRelationType> {
	const map = new Map<string, EdgeRelationType>();
	const entries: Array<[string[], EdgeRelationType]> = [
		[config.parents, 'parent'],
		[config.children, 'child'],
		[config.leftFriends, 'leftFriend'],
		[config.rightFriends, 'rightFriend'],
		[config.previous, 'previous'],
		[config.next, 'next'],
	];
	for (const [fields, type] of entries) {
		for (const field of fields) {
			map.set(field.toLowerCase(), type);
		}
	}
	return map;
}

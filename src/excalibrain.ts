import type { App } from 'obsidian';
import type { EdgeRelationType, ExcalibrainConfig } from './types';

/**
 * Attempt to load Excalibrain's saved configuration.
 * Returns null if the plugin is not installed or has never been opened.
 */
export async function loadExcalibrainConfig(app: App): Promise<ExcalibrainConfig | null> {
	const configPath = `${app.vault.configDir}/plugins/excalibrain/data.json`;
	try {
		const exists = await app.vault.adapter.exists(configPath);
		if (!exists) return null;
		const raw = await app.vault.adapter.read(configPath);
		const data = JSON.parse(raw);
		return {
			parents: toStringArray(data.parents),
			children: toStringArray(data.children),
			leftFriends: toStringArray(data.leftFriends),
			rightFriends: toStringArray(data.rightFriends),
			previous: toStringArray(data.previous),
			next: toStringArray(data.next),
		};
	} catch {
		return null;
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

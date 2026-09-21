import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
import type AutoTaggerPlugin from './main';

export interface AutoTaggerSettings {
	apiKey: string;
	tagLimit: number;
	maxBodyChars: number;
	dryRun: boolean;
	devMode: boolean;
}

export const TAG_LIMIT_MIN = 1;
export const TAG_LIMIT_MAX = 25;
export const MAX_BODY_CHARS_MIN = 200;

export function clampInt(
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(min, Math.round(value)));
}

export const DEFAULT_SETTINGS: AutoTaggerSettings = {
	apiKey: '',
	tagLimit: 15,
	maxBodyChars: 2000,
	dryRun: false,
	devMode: false,
};

export class AutoTaggerSettingTab extends PluginSettingTab {
	plugin: AutoTaggerPlugin;

	constructor(app: App, plugin: AutoTaggerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Typesafe API key',
				desc: 'Used to call the jev model. Stored locally in this vault.',
				render: (setting) => {
					setting.addText((text) => {
						text.inputEl.type = 'password';
						text
							.setPlaceholder('Paste your key')
							.setValue(this.plugin.settings.apiKey)
							.onChange(async (value) => {
								this.plugin.settings.apiKey = value.trim();
								await this.plugin.saveSettings();
							});
					});
				},
			},
			{
				name: 'Tags to consider',
				desc: 'How many of your most-used tags to send to jev (1 to 25).',
				control: {
					type: 'slider',
					key: 'tagLimit',
					min: TAG_LIMIT_MIN,
					max: TAG_LIMIT_MAX,
					step: 1,
				},
			},
			{
				name: 'Note body characters',
				desc: 'Maximum characters of the note body to send, taken from the start of the note.',
				control: {
					type: 'number',
					key: 'maxBodyChars',
					min: MAX_BODY_CHARS_MIN,
					step: 1,
					validate: (value: number) =>
						Number.isFinite(value) && value >= MAX_BODY_CHARS_MIN
							? undefined
							: `Enter at least ${MAX_BODY_CHARS_MIN}.`,
				},
			},
			{
				name: 'Dry run',
				desc: 'Show the suggested tag without applying it.',
				control: {
					type: 'toggle',
					key: 'dryRun',
				},
			},
			{
				name: 'Developer mode',
				desc: 'Log the raw jev response to the developer console.',
				control: {
					type: 'toggle',
					key: 'devMode',
				},
			},
		];
	}
}
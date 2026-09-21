import { MarkdownView, Notice, Plugin, requestUrl } from 'obsidian';
import {
	HttpRequest,
	HttpResponse,
	JevClient,
	JevError,
	NO_MATCH_OPTION,
	TagChoiceResult,
} from './jev-client';
import {
	AutoTaggerSettings,
	AutoTaggerSettingTab,
	clampInt,
	DEFAULT_SETTINGS,
	MAX_BODY_CHARS_MIN,
	TAG_LIMIT_MAX,
	TAG_LIMIT_MIN,
} from './settings';
import { applyTag, getTopTags, readNote } from './tagger';

async function postJson(request: HttpRequest): Promise<HttpResponse> {
	const response = await requestUrl({
		url: request.url,
		method: request.method,
		contentType: 'application/json',
		headers: request.headers,
		body: request.body,
		throw: false,
	});

	let json: unknown;
	try {
		json = response.json as unknown;
	} catch {
		json = undefined;
	}

	return {
		status: response.status,
		json,
		text: response.text,
	};
}

export default class AutoTaggerPlugin extends Plugin {
	settings!: AutoTaggerSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon('tag', 'Auto-tag current note', () => {
			void this.autoTagActiveNote();
		});

		this.addCommand({
			id: 'auto-tag-current-note',
			name: 'Auto-tag current note',
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (!view) return false;
				if (!checking) void this.autoTagActiveNote();
				return true;
			},
		});

		this.addSettingTab(new AutoTaggerSettingTab(this.app, this));
	}

	async loadSettings() {
		const data = (await this.loadData()) as Partial<AutoTaggerSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
		this.settings.tagLimit = clampInt(
			this.settings.tagLimit,
			TAG_LIMIT_MIN,
			TAG_LIMIT_MAX,
			DEFAULT_SETTINGS.tagLimit,
		);
		this.settings.maxBodyChars = clampInt(
			this.settings.maxBodyChars,
			MAX_BODY_CHARS_MIN,
			Number.MAX_SAFE_INTEGER,
			DEFAULT_SETTINGS.maxBodyChars,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private async autoTagActiveNote(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = view?.file;
		if (!file) {
			new Notice('Open a note to auto-tag.');
			return;
		}

		if (this.settings.apiKey.length === 0) {
			new Notice(
				'Add your typesafe API key in settings, auto tagger (jev).',
			);
			return;
		}

		const note = await readNote(this.app, file, this.settings.maxBodyChars);
		if (!note) {
			new Notice('This note is empty, so there is nothing to tag.');
			return;
		}

		const tags = getTopTags(this.app, this.settings.tagLimit);
		if (tags.length === 0) {
			new Notice('This vault has no existing tags to choose from.');
			return;
		}

		const client = new JevClient({
			apiKey: this.settings.apiKey,
			post: postJson,
		});

		let result: TagChoiceResult;
		try {
			result = await client.chooseTag(note.title, note.body, tags);
		} catch (error) {
			this.notifyError(error);
			return;
		}

		if (this.settings.devMode) {
			console.debug('[auto-tagger-jev]', result);
		}

		const percent = Math.round(result.confidence * 100);

		if (result.choice === NO_MATCH_OPTION) {
			new Notice(
				`No confident tag match among your existing tags (${percent}% confidence).`,
			);
			return;
		}

		if (!tags.includes(result.choice)) {
			new Notice(
				'Jev returned an unexpected tag, so the note was not changed.',
			);
			return;
		}

		if (this.settings.dryRun) {
			new Notice(
				`Dry run: would tag #${result.choice} (${percent}% confidence).`,
			);
			return;
		}

		try {
			const outcome = await applyTag(this.app, file, result.choice);
			if (outcome === 'already') {
				new Notice(
					`Already tagged #${result.choice} (${percent}% confidence).`,
				);
			} else {
				new Notice(`Tagged #${result.choice} (${percent}% confidence).`);
			}
		} catch (error) {
			console.error('[auto-tagger-jev] Failed to apply tag', error);
			new Notice('Could not write the tag to this note.');
		}
	}

	private notifyError(error: unknown): void {
		if (this.settings.devMode) {
			console.error('[auto-tagger-jev]', error);
		}
		if (error instanceof JevError) {
			switch (error.code) {
				case 'unauthorized':
					new Notice(
						'Typesafe rejected the API key. Check it in settings.',
					);
					return;
				case 'bad-request':
					new Notice(
						'Typesafe could not understand the request. Try a shorter note or fewer tags.',
					);
					return;
				case 'network':
					new Notice(
						'Could not reach typesafe. Check your connection and try again.',
					);
					return;
				case 'rate-limited':
					new Notice('Typesafe rate limit reached. Try again shortly.');
					return;
				case 'overloaded':
					new Notice('Typesafe is busy right now. Try again shortly.');
					return;
				case 'timeout':
					new Notice('The typesafe request timed out.');
					return;
				case 'malformed-response':
					new Notice('Typesafe returned an unexpected response.');
					return;
				case 'server':
					new Notice('Typesafe had a server error. Try again later.');
					return;
				default:
					new Notice('Could not reach typesafe.');
					return;
			}
		}
		new Notice('Could not reach typesafe.');
	}
}

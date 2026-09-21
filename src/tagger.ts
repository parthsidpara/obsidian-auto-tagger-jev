import { App, getAllTags, getFrontMatterInfo, TFile } from 'obsidian';

type TagCounts = Record<string, number>;

export interface NoteContent {
	title: string;
	body: string;
}

export type ApplyOutcome = 'frontmatter' | 'inline' | 'already';

export function normalizeTag(tag: string): string {
	return tag.startsWith('#') ? tag.slice(1) : tag;
}

export function getTopTags(app: App, limit: number): string[] {
	const counts = collectTagCounts(app);
	const merged = new Map<string, number>();

	for (const [rawTag, count] of Object.entries(counts)) {
		const tag = normalizeTag(rawTag);
		if (tag.length === 0) continue;
		merged.set(tag, (merged.get(tag) ?? 0) + count);
	}

	return [...merged.entries()]
		.sort(
			(a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
		)
		.slice(0, Math.max(0, limit))
		.map(([tag]) => tag);
}

function collectTagCounts(app: App): TagCounts {
	const cache = app.metadataCache as unknown as {
		getTags?: () => TagCounts;
	};
	if (typeof cache.getTags === 'function') {
		return cache.getTags();
	}
	return aggregateTagsFromFiles(app);
}

function aggregateTagsFromFiles(app: App): TagCounts {
	const counts: TagCounts = {};
	for (const file of app.vault.getMarkdownFiles()) {
		const fileCache = app.metadataCache.getFileCache(file);
		if (!fileCache) continue;
		const tags = getAllTags(fileCache);
		if (!tags) continue;
		for (const tag of tags) {
			counts[tag] = (counts[tag] ?? 0) + 1;
		}
	}
	return counts;
}

export async function readNote(
	app: App,
	file: TFile,
	maxBodyChars: number,
): Promise<NoteContent | null> {
	const content = await app.vault.cachedRead(file);
	const body = content.trim();
	if (body.length === 0) return null;
	const limit = Math.max(1, Math.floor(maxBodyChars));
	return {
		title: file.basename,
		body: body.slice(0, limit),
	};
}

export function getExistingTagNames(app: App, file: TFile): Set<string> {
	const names = new Set<string>();
	const fileCache = app.metadataCache.getFileCache(file);
	if (!fileCache) return names;
	const tags = getAllTags(fileCache);
	if (!tags) return names;
	for (const tag of tags) {
		names.add(normalizeTag(tag).toLowerCase());
	}
	return names;
}

export async function applyTag(
	app: App,
	file: TFile,
	tag: string,
): Promise<ApplyOutcome> {
	const normalized = normalizeTag(tag);
	if (getExistingTagNames(app, file).has(normalized.toLowerCase())) {
		return 'already';
	}

	const content = await app.vault.read(file);
	const info = getFrontMatterInfo(content);

	if (info.exists) {
		await app.fileManager.processFrontMatter(
			file,
			(frontmatter: Record<string, unknown>) => {
				const tags = readFrontmatterTags(frontmatter['tags']);
				if (
					tags.some(
						(value) => value.toLowerCase() === normalized.toLowerCase(),
					)
				) {
					return;
				}
				tags.push(normalized);
				frontmatter['tags'] = tags;
			},
		);
		return 'frontmatter';
	}

	await app.vault.process(file, (data) => {
		const suffix = data.endsWith('\n')
			? data.endsWith('\n\n')
				? ''
				: '\n'
			: '\n\n';
		return `${data}${suffix}#${normalized}\n`;
	});
	return 'inline';
}

function readFrontmatterTags(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === 'string');
	}
	if (typeof value === 'string') {
		return value
			.split(',')
			.map((part) => part.trim())
			.filter((part) => part.length > 0);
	}
	return [];
}

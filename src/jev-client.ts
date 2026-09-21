export const SYSTEMONE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const SYSTEMONE_MODEL = 'jev-latest';
export const NO_MATCH_OPTION = 'None of these fit well';

const NO_MATCH_DESCRIPTION = 'No existing tag fits this note';

export type JevErrorCode =
	| 'unauthorized'
	| 'bad-request'
	| 'rate-limited'
	| 'overloaded'
	| 'server'
	| 'malformed-response'
	| 'timeout'
	| 'network';

export class JevError extends Error {
	readonly code: JevErrorCode;

	constructor(code: JevErrorCode, message: string) {
		super(message);
		this.name = 'JevError';
		this.code = code;
	}
}

export interface HttpRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string;
}

export interface HttpResponse {
	status: number;
	json?: unknown;
	text?: string;
}

export type HttpPost = (request: HttpRequest) => Promise<HttpResponse>;

export interface JevUsage {
	input_tokens: number;
	output_tokens: number;
}

export interface TagChoiceResult {
	choice: string;
	confidence: number;
	probabilities: Record<string, number>;
	model: string;
	usage?: JevUsage;
	raw: unknown;
}

export interface NoteState {
	note_title: string;
	note_body: string;
}

export interface SystemOneRequest {
	state: NoteState;
	model: string;
	questions: {
		best_tag: {
			type: 'choice';
			instructions: string;
			criteria: Record<string, string | null>;
		};
	};
}

export interface JevClientOptions {
	apiKey: string;
	post: HttpPost;
	timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function buildTagChoiceRequest(
	title: string,
	body: string,
	tags: string[],
): SystemOneRequest {
	const criteria: Record<string, string | null> = {};
	for (const tag of tags) {
		if (tag === NO_MATCH_OPTION) continue;
		criteria[tag] = null;
	}
	criteria[NO_MATCH_OPTION] = NO_MATCH_DESCRIPTION;

	return {
		state: {
			note_title: title,
			note_body: body,
		},
		model: SYSTEMONE_MODEL,
		questions: {
			best_tag: {
				type: 'choice',
				instructions: 'Which tag best matches the content of this note?',
				criteria,
			},
		},
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseUsage(value: unknown): JevUsage | undefined {
	if (!isRecord(value)) return undefined;
	const input = value['input_tokens'];
	const output = value['output_tokens'];
	if (typeof input !== 'number' || typeof output !== 'number') return undefined;
	return { input_tokens: input, output_tokens: output };
}

export function parseTagChoiceResponse(json: unknown): TagChoiceResult {
	const answers = isRecord(json) ? json['answers'] : undefined;
	const answer = isRecord(answers) ? answers['best_tag'] : undefined;
	if (!isRecord(answer)) {
		throw new JevError(
			'malformed-response',
			'Response did not contain a best_tag answer.',
		);
	}

	const choice = answer['choice'];
	if (typeof choice !== 'string' || choice.length === 0) {
		throw new JevError('malformed-response', 'Answer had no chosen option.');
	}

	const confidence = answer['confidence'];
	if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
		throw new JevError(
			'malformed-response',
			'Answer had no usable confidence value.',
		);
	}

	const rawProbabilities = answer['probabilities'];
	if (!isRecord(rawProbabilities)) {
		throw new JevError(
			'malformed-response',
			'Answer had no probability distribution.',
		);
	}

	const probabilities: Record<string, number> = {};
	for (const [option, value] of Object.entries(rawProbabilities)) {
		if (typeof value !== 'number') {
			throw new JevError(
				'malformed-response',
				'Probability distribution contained a non-numeric value.',
			);
		}
		probabilities[option] = value;
	}

	const model =
		isRecord(json) && typeof json['model'] === 'string'
			? json['model']
			: SYSTEMONE_MODEL;

	return {
		choice,
		confidence,
		probabilities,
		model,
		usage: isRecord(json) ? parseUsage(json['usage']) : undefined,
		raw: json,
	};
}

export class JevClient {
	private readonly apiKey: string;
	private readonly post: HttpPost;
	private readonly timeoutMs: number;

	constructor(options: JevClientOptions) {
		this.apiKey = options.apiKey;
		this.post = options.post;
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	}

	async chooseTag(
		title: string,
		body: string,
		tags: string[],
	): Promise<TagChoiceResult> {
		const request = buildTagChoiceRequest(title, body, tags);

		let response: HttpResponse;
		try {
			response = await this.withTimeout(
				this.post({
					url: SYSTEMONE_ENDPOINT,
					method: 'POST',
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(request),
				}),
			);
		} catch (error) {
			if (error instanceof JevError) throw error;
			throw new JevError(
				'network',
				error instanceof Error ? error.message : 'Network request failed.',
			);
		}

		this.throwForStatus(response);
		return parseTagChoiceResponse(response.json);
	}

	private withTimeout(promise: Promise<HttpResponse>): Promise<HttpResponse> {
		if (this.timeoutMs <= 0) return promise;
		return new Promise<HttpResponse>((resolve, reject) => {
			const timer = window.setTimeout(() => {
				reject(
					new JevError(
						'timeout',
						`TypeSafe did not respond within ${this.timeoutMs} ms.`,
					),
				);
			}, this.timeoutMs);
			promise.then(
				(value) => {
					window.clearTimeout(timer);
					resolve(value);
				},
				(error: unknown) => {
					window.clearTimeout(timer);
					reject(
						error instanceof Error
							? error
							: new JevError('network', 'Network request failed.'),
					);
				},
			);
		});
	}

	private throwForStatus(response: HttpResponse): void {
		if (response.status >= 200 && response.status < 300) return;
		const detail = extractErrorDetail(response);
		if (response.status === 401) {
			throw new JevError('unauthorized', `Unauthorized: ${detail}`);
		}
		if (response.status === 422) {
			throw new JevError('bad-request', `Invalid request: ${detail}`);
		}
		if (response.status === 429) {
			throw new JevError('rate-limited', `Rate limited: ${detail}`);
		}
		if (response.status === 529) {
			throw new JevError('overloaded', `Overloaded: ${detail}`);
		}
		if (response.status >= 500) {
			throw new JevError('server', `Server error: ${detail}`);
		}
		throw new JevError('bad-request', `Request failed: ${detail}`);
	}
}

function extractErrorDetail(response: HttpResponse): string {
	const body = response.json;
	if (isRecord(body)) {
		const message = body['message'];
		if (typeof message === 'string' && message.length > 0) return message;
		const error = body['error'];
		if (typeof error === 'string' && error.length > 0) return error;
	}
	if (typeof response.text === 'string' && response.text.length > 0) {
		return response.text.slice(0, 200);
	}
	return `HTTP ${response.status}`;
}

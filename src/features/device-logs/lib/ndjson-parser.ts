import { StringDecoder } from 'node:string_decoder';

/**
 * Parses newline delimited JSON pushed to it in chunks, calling `onRow` for each row. This matches
 * `ndjson.parse()` (lines split on `\n` or `\r\n`, empty lines skipped, a final row without a newline parsed at the
 * end), but without a Transform stream and its per-row overhead.
 *
 * A row that isn't valid JSON calls `onError` once and stops the parser, after which further input is ignored.
 */
export class NdjsonParser {
	private decoder = new StringDecoder('utf8');
	// The start of a row whose newline hasn't arrived yet, it never contains a `\n`
	private partialRow = '';
	private failed = false;
	private onRow;
	private onError;

	constructor(onRow: (row: unknown) => void, onError: (err: Error) => void) {
		this.onRow = onRow;
		this.onError = onError;
	}

	public write(chunk: Buffer): void {
		if (this.failed) {
			return;
		}
		const str = this.decoder.write(chunk);
		let end = str.indexOf('\n');
		if (end === -1) {
			this.partialRow += str;
			return;
		}
		// Only the new data is searched for newlines, so a long row arriving in many chunks isn't rescanned
		this.parseRow(this.partialRow + str.slice(0, end));
		let start = end + 1;
		while (!this.failed && (end = str.indexOf('\n', start)) !== -1) {
			this.parseRow(str.slice(start, end));
			start = end + 1;
		}
		this.partialRow = str.slice(start);
	}

	public end(): void {
		if (this.failed) {
			return;
		}
		const row = this.partialRow + this.decoder.end();
		this.partialRow = '';
		this.parseRow(row);
	}

	private parseRow(row: string) {
		if (row.endsWith('\r')) {
			row = row.slice(0, -1);
		}
		if (row === '') {
			return;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(row);
		} catch {
			this.failed = true;
			this.onError(new Error(`Could not parse row ${row.slice(0, 50)}...`));
			return;
		}
		this.onRow(parsed);
	}
}

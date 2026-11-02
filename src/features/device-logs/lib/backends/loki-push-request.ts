/**
 * Encodes Loki push requests (`logproto.PushRequest`) straight from plain objects. This produces the same bytes as
 * building and serializing google-protobuf messages, but without allocating a message object per entry or encoding
 * strings to UTF-8 in JavaScript, which were most of the CPU cost of each push.
 *
 * message PushRequest { repeated StreamAdapter streams = 1; }
 * message StreamAdapter { string labels = 1; repeated EntryAdapter entries = 2; }
 * message EntryAdapter {
 *   google.protobuf.Timestamp timestamp = 1;
 *   string line = 2;
 *   repeated LabelPairAdapter structuredMetadata = 3;
 * }
 * message Timestamp { int64 seconds = 1; int32 nanos = 2; }
 * message LabelPairAdapter { string name = 1; string value = 2; }
 */

export interface LokiLabelPair {
	name: string;
	value: string;
}
export interface LokiEntry {
	seconds: number;
	nanos: number;
	line: string;
	/** Usually shared between the entries of a request, it is encoded once per distinct array */
	structuredMetadata: readonly LokiLabelPair[];
}
export interface LokiStream {
	labels: string;
	entries: LokiEntry[];
}

// Negative int32/int64 values are sign extended to 64 bits, which always takes 10 bytes
const varintSize = (v: number): number => {
	if (v < 0) {
		return 10;
	}
	let size = 1;
	while (v >= 128) {
		v = Math.floor(v / 128);
		size++;
	}
	return size;
};

// Each byte holds 7 bits of the value, lowest first, with 128 added to every byte but the last
const writeVarint = (buf: Buffer, pos: number, v: number): number => {
	if (v < 0) {
		let u = BigInt.asUintN(64, BigInt(v));
		while (u >= 128n) {
			buf[pos++] = Number(u % 128n) + 128;
			u /= 128n;
		}
		buf[pos++] = Number(u);
		return pos;
	}
	while (v >= 128) {
		buf[pos++] = (v % 128) + 128;
		v = Math.floor(v / 128);
	}
	buf[pos++] = v;
	return pos;
};

/** The size of a length delimited field: tag, length and content */
const fieldSize = (len: number) => 1 + varintSize(len) + len;

const timestampSize = (seconds: number, nanos: number) =>
	(seconds !== 0 ? 1 + varintSize(seconds) : 0) +
	(nanos !== 0 ? 1 + varintSize(nanos) : 0);

/** Encodes the `structuredMetadata` fields of an entry, including their tags */
const encodeStructuredMetadata = (pairs: readonly LokiLabelPair[]): Buffer => {
	let size = 0;
	const sizes = pairs.map(({ name, value }) => {
		const nameLen = Buffer.byteLength(name);
		const valueLen = Buffer.byteLength(value);
		const pairSize =
			(nameLen > 0 ? fieldSize(nameLen) : 0) +
			(valueLen > 0 ? fieldSize(valueLen) : 0);
		size += fieldSize(pairSize);
		return { nameLen, valueLen, pairSize };
	});
	const buf = Buffer.allocUnsafe(size);
	let pos = 0;
	for (let i = 0; i < pairs.length; i++) {
		const { nameLen, valueLen, pairSize } = sizes[i];
		buf[pos++] = 0x1a; // field 3, length delimited
		pos = writeVarint(buf, pos, pairSize);
		if (nameLen > 0) {
			buf[pos++] = 0x0a; // field 1, length delimited
			pos = writeVarint(buf, pos, nameLen);
			pos += buf.write(pairs[i].name, pos, nameLen, 'utf8');
		}
		if (valueLen > 0) {
			buf[pos++] = 0x12; // field 2, length delimited
			pos = writeVarint(buf, pos, valueLen);
			pos += buf.write(pairs[i].value, pos, valueLen, 'utf8');
		}
	}
	return buf;
};

export const encodePushRequest = (streams: LokiStream[]): Buffer => {
	// The first pass works out the size of every message, as each one is prefixed by its length
	const metadataCache = new Map<readonly LokiLabelPair[], Buffer>();
	const lineLens: number[] = [];
	const entrySizes: number[] = [];
	const labelLens: number[] = [];
	const streamSizes: number[] = [];
	let total = 0;
	for (const { labels, entries } of streams) {
		const labelsLen = Buffer.byteLength(labels);
		let streamSize = labelsLen > 0 ? fieldSize(labelsLen) : 0;
		for (const entry of entries) {
			let metadata = metadataCache.get(entry.structuredMetadata);
			if (metadata === undefined) {
				metadata = encodeStructuredMetadata(entry.structuredMetadata);
				metadataCache.set(entry.structuredMetadata, metadata);
			}
			const lineLen = Buffer.byteLength(entry.line);
			const entrySize =
				fieldSize(timestampSize(entry.seconds, entry.nanos)) +
				(lineLen > 0 ? fieldSize(lineLen) : 0) +
				metadata.length;
			lineLens.push(lineLen);
			entrySizes.push(entrySize);
			streamSize += fieldSize(entrySize);
		}
		labelLens.push(labelsLen);
		streamSizes.push(streamSize);
		total += fieldSize(streamSize);
	}

	const buf = Buffer.allocUnsafe(total);
	let pos = 0;
	let e = 0;
	for (let s = 0; s < streams.length; s++) {
		const { labels, entries } = streams[s];
		buf[pos++] = 0x0a; // PushRequest.streams
		pos = writeVarint(buf, pos, streamSizes[s]);
		const labelsLen = labelLens[s];
		if (labelsLen > 0) {
			buf[pos++] = 0x0a; // StreamAdapter.labels
			pos = writeVarint(buf, pos, labelsLen);
			pos += buf.write(labels, pos, labelsLen, 'utf8');
		}
		for (const { seconds, nanos, line, structuredMetadata } of entries) {
			buf[pos++] = 0x12; // StreamAdapter.entries
			pos = writeVarint(buf, pos, entrySizes[e]);
			buf[pos++] = 0x0a; // EntryAdapter.timestamp, always present like with google-protobuf
			pos = writeVarint(buf, pos, timestampSize(seconds, nanos));
			if (seconds !== 0) {
				buf[pos++] = 0x08; // Timestamp.seconds, varint
				pos = writeVarint(buf, pos, seconds);
			}
			if (nanos !== 0) {
				buf[pos++] = 0x10; // Timestamp.nanos, varint
				pos = writeVarint(buf, pos, nanos);
			}
			const lineLen = lineLens[e];
			if (lineLen > 0) {
				buf[pos++] = 0x12; // EntryAdapter.line
				pos = writeVarint(buf, pos, lineLen);
				pos += buf.write(line, pos, lineLen, 'utf8');
			}
			pos += metadataCache.get(structuredMetadata)!.copy(buf, pos);
			e++;
		}
	}
	if (pos !== total) {
		throw new Error(
			`Encoded ${pos} bytes of a ${total} byte Loki push request`,
		);
	}
	return buf;
};

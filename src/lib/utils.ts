import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import ipaddr from 'ipaddr.js';
import fs from 'fs';
import { promisify } from 'util';
import { setTimeout } from 'timers/promises';

// process.hrtime() will give nanos, but it is from an unknown relative time, not epoch.
// This approach calculates the difference and adds to get the current nano time.
const loadNs = BigInt(Date.now()) * 1000000n - process.hrtime.bigint();

export function getNanoTimestamp() {
	return loadNs + process.hrtime.bigint();
}

export const randomBytesAsync = promisify(randomBytes);

export const isValidInteger = (num: any): num is number => {
	const n = checkInt(num);
	return n !== false && n > 0;
};

export const checkInt = (num?: string): number | false => {
	if (num == null) {
		return false;
	}
	const n = parseInt(num, 10);
	if (Number.isNaN(n)) {
		return false;
	}
	return n;
};

export const getIP = (req: Request): string | undefined =>
	// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
	req.ip ||
	(req as any)._remoteAddress ||
	req.connection?.remoteAddress ||
	undefined;

// Returns the IPv4 formatted address if possible, or undefined if not
export const getIPv4 = (req: Request): string | undefined => {
	try {
		const rawIp = getIP(req);
		if (rawIp == null) {
			return;
		}
		const ip = ipaddr.parse(rawIp);

		if (ip.kind() === 'ipv4') {
			return ip.toString();
		} else if (ip instanceof ipaddr.IPv6 && ip.isIPv4MappedAddress()) {
			return ip.toIPv4Address().toString();
		}
	} catch {
		// Ignore errors
	}
};

export const getBase64DataUri = async (
	filePath: string,
	mimeType: 'image/png' | 'image/svg+xml',
) => {
	const base64Content = (await fs.promises.readFile(filePath)).toString(
		'base64',
	);
	return `data:${mimeType};base64,${base64Content}`;
};

export const b64decode = (str: string): string =>
	Buffer.from(str, 'base64').toString().trim();

export const throttledForEach = async <T, U>(
	array: T[],
	delayMS: number,
	fn: (item: T) => PromiseLike<U> | U,
): Promise<U[]> => {
	const promises: Array<PromiseLike<U> | U> = [];
	for (const item of array) {
		// We do not wait for each individual fn, we just throttle the calling of them
		promises.push(fn(item));
		// Delay by the throttle rate before we continue to the next item
		await setTimeout(delayMS);
	}
	// We return the results of the iterator so the caller can await them as necessary
	return await Promise.all(promises);
};

export const withRetries = async <T>(
	func: () => Promise<T>,
	delayDuration = 2000,
	retries = 2,
): Promise<T> => {
	try {
		return await func();
	} catch (err) {
		if (retries <= 0) {
			throw err;
		}

		await setTimeout(delayDuration);
		return await withRetries(func, delayDuration, retries - 1);
	}
};

/**
 * Useful when you want to avoid having to manually parse the key
 * or when need order guarantees while iterating the keys.
 */
export const groupByMap = <K, V>(entries: V[], iteratee: (item: V) => K) => {
	const result = new Map<K, V[]>();
	for (const entry of entries) {
		const key = iteratee(entry);
		let keyGroup = result.get(key);
		if (keyGroup == null) {
			keyGroup = [];
			result.set(key, keyGroup);
		}
		keyGroup.push(entry);
	}
	return result;
};

export const getBodyOrQueryParam = (
	req: Request,
	paramName: string,
	defaultValue?: string,
) => req.body[paramName] ?? req.query[paramName] ?? defaultValue;

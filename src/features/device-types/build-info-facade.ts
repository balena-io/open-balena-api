import { multiCacheMemoizee } from '../../infra/cache/index.js';

import type { DeviceTypeJson } from './device-type-json.js';

import {
	BUILD_COMPRESSED_SIZE_CACHE_TIMEOUT,
	BUILD_PROPERTY_CACHE_TIMEOUT,
	FILES_HOST,
} from '../../lib/config.js';
import {
	fileExists,
	getFile,
	getFolderSize,
	getImageKey,
} from './storage/index.js';

const $getLogoUrl = multiCacheMemoizee(
	async (
		normalizedSlug: string,
		buildId: string,
	): Promise<string | undefined> => {
		const pathComponents = [normalizedSlug, buildId, 'logo.svg'];
		try {
			const logoKey = getImageKey(...pathComponents);
			const hasLogo = await fileExists(logoKey);
			if (!hasLogo) {
				return;
			}

			// url encode since the buildId can contain a `+`
			return getImageKey(...pathComponents.map(encodeURIComponent));
		} catch {
			return;
		}
	},
	{
		cacheKey: '$getLogoUrl',
		undefinedAs: false,
		promise: true,
		primitive: true,
		preFetch: true,
		maxAge: BUILD_PROPERTY_CACHE_TIMEOUT,
	},
	{ useVersion: false },
);
export const getLogoUrl = async (
	normalizedSlug: string,
	buildId: string,
): Promise<string | undefined> => {
	if (!FILES_HOST) {
		return;
	}
	const encodedLogoPath = await $getLogoUrl(normalizedSlug, buildId);
	if (!encodedLogoPath) {
		return;
	}
	return `https://${FILES_HOST}/${encodedLogoPath}`;
};

export const getDeviceTypeJson = multiCacheMemoizee(
	async (
		normalizedSlug: string,
		buildId: string,
	): Promise<DeviceTypeJson | undefined> => {
		const isIgnored = await fileExists(
			getImageKey(normalizedSlug, buildId, 'IGNORE'),
		);
		if (isIgnored) {
			return undefined;
		}
		const response = await getFile(
			getImageKey(normalizedSlug, buildId, 'device-type.json'),
		);
		const deviceType =
			response && response.Body
				? (JSON.parse(response.Body.toString()) as DeviceTypeJson)
				: undefined;
		if (deviceType) {
			deviceType.buildId = buildId;
		}
		return deviceType;
	},
	{
		cacheKey: 'getDeviceTypeJson',
		undefinedAs: false,
		promise: true,
		primitive: true,
		preFetch: true,
		maxAge: BUILD_PROPERTY_CACHE_TIMEOUT,
	},
	{ useVersion: false },
);

export const getCompressedSize = multiCacheMemoizee(
	async (normalizedSlug: string, buildId: string): Promise<number> => {
		return await getFolderSize(
			getImageKey(normalizedSlug, buildId, 'compressed'),
		);
	},
	{
		cacheKey: 'getCompressedSize',
		promise: true,
		primitive: true,
		preFetch: true,
		maxAge: BUILD_COMPRESSED_SIZE_CACHE_TIMEOUT,
	},
	{ useVersion: false },
);

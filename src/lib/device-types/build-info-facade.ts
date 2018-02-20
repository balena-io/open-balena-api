import * as memoizee from 'memoizee';
import * as deviceTypesLib from '@resin.io/device-types';
import { fileExists, getFile, getFolderSize, getImageKey } from './storage';

export type DeviceType = deviceTypesLib.DeviceType;

const BUILD_PROPERTY_CACHE_EXPIRATION = 10 * 60 * 1000; // 10 mins
const BUILD_COMPRESSED_SIZE_CACHE_EXPIRATION = 20 * 60 * 1000; // 20 mins

export const getIsIgnored = memoizee(
	(normalizedSlug: string, buildId: string) => {
		return fileExists(getImageKey(normalizedSlug, buildId, 'IGNORE'));
	},
	{ promise: true, preFetch: true, maxAge: BUILD_PROPERTY_CACHE_EXPIRATION },
);

export const getDeviceTypeJson = memoizee(
	(normalizedSlug: string, buildId: string) => {
		return getFile(
			getImageKey(normalizedSlug, buildId, 'device-type.json'),
		).then(response => {
			const deviceType =
				response && response.Body
					? (JSON.parse(response.Body.toString()) as DeviceType)
					: undefined;
			if (deviceType) {
				deviceType.buildId = buildId;
			}
			return deviceType;
		});
	},
	{ promise: true, preFetch: true, maxAge: BUILD_PROPERTY_CACHE_EXPIRATION },
);

export const getCompressedSize = memoizee(
	(normalizedSlug: string, buildId: string) => {
		return getFolderSize(getImageKey(normalizedSlug, buildId, 'compressed'));
	},
	{
		promise: true,
		preFetch: true,
		maxAge: BUILD_COMPRESSED_SIZE_CACHE_EXPIRATION,
	},
);

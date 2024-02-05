import { getKey } from './s3.js';
export * from './s3.js';
import { IMAGE_STORAGE_PREFIX } from '../../../lib/config.js';

export { IMAGE_STORAGE_PREFIX } from '../../../lib/config.js';

export const getImageKey = (...parts: string[]): string =>
	getKey(IMAGE_STORAGE_PREFIX, ...parts);

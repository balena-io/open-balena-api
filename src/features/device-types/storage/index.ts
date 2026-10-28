import { getKey } from './s3.ts';
export * from './s3.ts';
import { IMAGE_STORAGE_PREFIX } from '../../../lib/config.ts';

export { IMAGE_STORAGE_PREFIX } from '../../../lib/config.ts';

export const getImageKey = (...parts: string[]): string =>
	getKey(IMAGE_STORAGE_PREFIX, ...parts);

import { getKey } from './s3';
export * from './s3';
import { IMAGE_STORAGE_PREFIX } from '../../../lib/config';

export { IMAGE_STORAGE_PREFIX } from '../../../lib/config';

export const getImageKey = (...parts: string[]): string =>
	getKey(IMAGE_STORAGE_PREFIX, ...parts);

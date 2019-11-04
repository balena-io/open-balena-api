import { getKey } from './s3';
export * from './s3';
import { IMAGE_STORAGE_PREFIX, IMAGE_ESR_STORAGE_PREFIX } from '../../config';

export { IMAGE_STORAGE_PREFIX } from '../../config';

export const getImageKey = (...parts: string[]): string =>
	getKey(IMAGE_STORAGE_PREFIX, ...parts);

export const getESRImageKey = (...parts: string[]): string =>
	getKey(IMAGE_ESR_STORAGE_PREFIX, ...parts);

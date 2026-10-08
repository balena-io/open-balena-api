import { errors } from '@balena/pinejs';
import slugify from 'slugify';

const { BadRequestError } = errors;

const normalizeReplacements = /[^\w]+/g;

export const normalizeHandle = (handle: string): string => {
	return slugify(handle, {
		replacement: '_',
		lower: true,
	}).replace(normalizeReplacements, '_');
};

export const validateHandle = (handle: string) => {
	if (normalizeReplacements.test(handle)) {
		throw new BadRequestError(
			'Handles can only contain alphanumeric characters and underscores',
		);
	}
	if (handle !== handle.toLowerCase()) {
		throw new BadRequestError('Handles must be lowercase');
	}
};

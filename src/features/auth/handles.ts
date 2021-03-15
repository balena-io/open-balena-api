import { errors } from '@balena/pinejs';

const { BadRequestError } = errors;

const normalizeReplacements = /[^\w]+/g;

export const normalizeHandle = (handle: string): string => {
	return handle.replace(normalizeReplacements, '_').toLowerCase();
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

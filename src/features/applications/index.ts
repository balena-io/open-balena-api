import { errors } from '@balena/pinejs';

export const getApplicationSlug = (
	orgHandle: string,
	appName: string,
): string => {
	if (orgHandle == null) {
		throw new errors.BadRequestError('Missing organization handle');
	}

	if (appName == null) {
		throw new errors.BadRequestError('Missing application name');
	}

	return `${orgHandle}/${appName}`.toLowerCase();
};

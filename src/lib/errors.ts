import { TypedError } from 'typed-error';

import { errors } from '@balena/pinejs';

const { NotFoundError, BadRequestError } = errors;

export type { NotFoundError, BadRequestError };

export class NoDevicesFoundError extends NotFoundError {}

export class InaccessibleAppError extends TypedError {
	constructor(
		message = "Application doesn't exist or you have no access to it.",
	) {
		super(message);
	}
}

export class InvalidDeviceTypeError extends BadRequestError {}

export class UnknownDeviceTypeError extends NotFoundError {
	constructor(slug: string) {
		super(`Unknown device type ${slug}`);
	}
}

export class UnknownVersionError extends NotFoundError {
	constructor(slug: string, buildId: string) {
		super(`Device ${slug} not found for ${buildId} version`);
	}
}

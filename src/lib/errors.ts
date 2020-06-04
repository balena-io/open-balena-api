import { TypedError } from 'typed-error';

import { errors } from '@balena/pinejs';

const { NotFoundError } = errors;

export type { NotFoundError };

export class NoDevicesFoundError extends NotFoundError {}

export class InaccessibleAppError extends TypedError {
	constructor(
		message = "Application doesn't exist or you have no access to it.",
	) {
		super(message);
	}
}

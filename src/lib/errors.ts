import { TypedError } from 'typed-error';
import { sbvrUtils } from '@resin/pinejs';

export const { NotFoundError } = sbvrUtils;

export class NoDevicesFoundError extends NotFoundError {}

export class InaccessibleAppError extends TypedError {
	constructor(
		message = "Application doesn't exist or you have no access to it.",
	) {
		super(message);
	}
}

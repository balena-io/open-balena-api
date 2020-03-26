import type { Request, Response } from 'express';
import * as _ from 'lodash';
import * as Raven from 'raven';

import { sbvrUtils } from '@resin/pinejs';

const { InternalRequestError, HttpError } = sbvrUtils;

export const translateError = (err: Error | number | string): string => {
	if (err instanceof InternalRequestError) {
		return 'Server Error';
	}
	if (err instanceof Error) {
		return err.message;
	}
	return `${err}`;
};

interface HookReqCaptureOptions {
	req?: sbvrUtils.HookReq | Raven.CaptureOptions['req'];
}

type Overwrite<T, U> = Pick<T, Exclude<keyof T, keyof U>> & U;

// Raven is actually fine with our trimmed down `req` from hooks, but it isn't typed that way
// so we have to overwrite and then cast later
interface CaptureOptions
	extends Overwrite<Raven.CaptureOptions, HookReqCaptureOptions> {}

export function captureException(
	err: Error,
	message?: string,
	options: CaptureOptions = {},
): void {
	// if err does not have a message or a stack, we have no information about that error
	if (_.isObject(err) && err.message == null) {
		console.error(message, err);
	} else {
		console.error(message, err.message, err.stack);
	}
	if (message) {
		options.extra = options.extra || {};
		// Trim mostly for removing trailing new lines intended for the console
		message = message.trim();
		options.extra.message = message;
		// We throw some errors where the constructor receives no message
		// But also sometimes `err` is not really an Error, f.e a number
		if (err instanceof Error && !err.message) {
			err.message = message;
		}
	}
	Raven.captureException(err, options as Raven.CaptureOptions);
}

export const handleHttpErrors = (req: Request, res: Response, err: Error) => {
	if (err instanceof HttpError) {
		if (err instanceof InternalRequestError) {
			captureException(err, 'Internal server error', { req });
			if (err.body == null) {
				err.body = 'Server error';
			}
		}
		let responseBody = err.getResponseBody();
		if (typeof responseBody !== 'object') {
			responseBody = { error: responseBody };
		}
		res.status(err.status).json(responseBody);
		return true;
	}
	return false;
};

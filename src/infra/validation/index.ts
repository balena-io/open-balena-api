import type { Request, RequestHandler } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { z } from 'zod';
export { z } from 'zod';

export type RequestExcludingInput = Omit<
	Request<ParamsDictionary, any, unknown, unknown> & Express.Request,
	'body' | 'query'
> & {
	body?: unknown;
	query?: unknown;
};

export function createValidatedRequestHandler(
	handler: RequestHandler<
		ParamsDictionary,
		any,
		undefined,
		Record<string, never>
	>,
): typeof handler;
export function createValidatedRequestHandler(
	opts: { body?: undefined; query?: undefined },
	handler: RequestHandler<
		ParamsDictionary,
		any,
		undefined,
		Record<string, never>
	>,
): typeof handler;
export function createValidatedRequestHandler<QuerySchema extends z.ZodType>(
	opts: { body?: undefined; query: QuerySchema },
	handler: RequestHandler<
		ParamsDictionary,
		any,
		undefined,
		z.infer<QuerySchema>
	>,
): typeof handler;
export function createValidatedRequestHandler<BodySchema extends z.ZodType>(
	opts: { body: BodySchema; query?: undefined },
	handler: RequestHandler<
		ParamsDictionary,
		any,
		z.infer<BodySchema>,
		Record<string, never>
	>,
): typeof handler;
export function createValidatedRequestHandler<
	BodySchema extends z.ZodType,
	QuerySchema extends z.ZodType,
>(
	opts: { body: BodySchema; query: QuerySchema },
	handler: RequestHandler<
		ParamsDictionary,
		any,
		z.infer<BodySchema>,
		z.infer<QuerySchema>
	>,
): typeof handler;
export function createValidatedRequestHandler<
	BodySchema extends z.ZodType,
	QuerySchema extends z.ZodType,
>(
	opts:
		| { body?: BodySchema; query?: QuerySchema }
		| RequestHandler<ParamsDictionary, any, undefined, Record<string, never>>,
	handler?: RequestHandler<
		ParamsDictionary,
		any,
		z.infer<BodySchema> | undefined,
		z.infer<QuerySchema> | Record<string, never>
	>,
): typeof handler {
	let body: BodySchema | undefined;
	let query: QuerySchema | undefined;
	let $handler: Exclude<typeof handler, undefined>;
	if (typeof opts === 'function') {
		$handler = opts as typeof $handler;
	} else {
		$handler = handler!;
		({ body, query } = opts);
	}
	return (req, res, next) => {
		try {
			req.query = query ? query.parse(req.query) : {};
			req.body = body ? body.parse(req.body) : undefined;
		} catch {
			res.status(400).end();
			return;
		}
		$handler(req, res, next);
	};
}

/**
 * This marks an unvalidated handler and sets the typings as having no query/body accessible, however it doesn't actually enforce that
 * and so could be bypassed and still have those accessed without validation. It is not ideal but it does add at least some safety, and
 * importantly visibility into such endpoints
 */
export const createUnvalidatedRequestHandler = (
	handler: RequestHandler<
		ParamsDictionary,
		any,
		undefined,
		Record<string, never>
	>,
) => handler;

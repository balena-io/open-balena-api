import type {
	Application,
	NextFunction,
	RequestHandler,
	Request,
	Response,
} from 'express';
import _ from 'lodash';

export const forwardRequests = (
	app: Application,
	fromVersion: string,
	toVersion: string,
) => {
	const fromRegex = new RegExp(`^/${_.escapeRegExp(fromVersion)}`, 'i');
	const fromRoute = `/${fromVersion}/*`;
	const toRoute = `/${toVersion}`;

	const handler: RequestHandler = (
		req: Request,
		_res: Response,
		next: NextFunction,
	) => {
		req.url = req.url.replace(fromRegex, toRoute);
		next('route');
	};
	app
		.route(fromRoute)
		.options((_req, res) => res.status(200).end())
		.get(handler)
		.put(handler)
		.post(handler)
		.patch(handler)
		.merge(handler)
		.delete(handler);
};

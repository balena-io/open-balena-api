import type { Application } from 'express';
import _ from 'lodash';

export const forwardRequests = (
	app: Application,
	fromVersion: string,
	toVersion: string,
) => {
	const fromRegex = new RegExp(`^/${_.escapeRegExp(fromVersion)}`, 'i');
	const fromRoute = `/${fromVersion}/*`;
	const toRoute = `/${toVersion}`;
	app.options(fromRoute, (_req, res) => res.status(200).end());
	app.all(fromRoute, (req, _res, next) => {
		req.url = req.url.replace(fromRegex, toRoute);
		next('route');
	});
};

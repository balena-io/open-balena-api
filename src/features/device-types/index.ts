import type { Application } from 'express';
import { middleware } from '../../infra/auth/index.js';
import {
	downloadImageSize,
	getDeviceType,
	getDeviceTypes,
	listAvailableImageVersions,
} from './routes.js';

export const setup = (app: Application) => {
	app.get(
		'/device-types/v1',
		middleware.resolveCredentialsAndUser,
		getDeviceTypes,
	);
	app.get(
		'/device-types/v1/:deviceType',
		middleware.resolveCredentialsAndUser,
		getDeviceType,
	);
	app.get(
		'/device-types/v1/:deviceType/images',
		middleware.resolveCredentialsAndUser,
		listAvailableImageVersions,
	);
	app.get(
		'/device-types/v1/:deviceType/images/:version/download-size',
		middleware.resolveCredentialsAndUser,
		downloadImageSize,
	);
};

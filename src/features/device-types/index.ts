import type { Application } from 'express';
import { middleware } from '../../infra/auth/index.ts';
import { downloadImageSize, getDeviceType, getDeviceTypes } from './routes.ts';

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
		'/device-types/v1/:deviceType/images/:version/download-size',
		middleware.resolveCredentialsAndUser,
		downloadImageSize,
	);
};

import type { Application } from 'express';
import { middleware } from '../../infra/auth';
import {
	downloadImageSize,
	getDeviceType,
	getDeviceTypes,
	listAvailableImageVersions,
} from './routes';

export const setup = (app: Application) => {
	app.get('/device-types/v1', middleware.identify, getDeviceTypes);
	app.get('/device-types/v1/:deviceType', middleware.identify, getDeviceType);
	app.get(
		'/device-types/v1/:deviceType/images',
		middleware.identify,
		listAvailableImageVersions,
	);
	app.get(
		'/device-types/v1/:deviceType/images/:version/download-size',
		middleware.identify,
		downloadImageSize,
	);
};

import type { Application } from 'express';
import { identifyMiddleware } from '../../infra/auth';
import {
	downloadImageSize,
	getDeviceType,
	getDeviceTypes,
	listAvailableImageVersions,
} from './routes';

export const setup = (app: Application) => {
	app.get('/device-types/v1', identifyMiddleware, getDeviceTypes);
	app.get('/device-types/v1/:deviceType', identifyMiddleware, getDeviceType);
	app.get(
		'/device-types/v1/:deviceType/images',
		identifyMiddleware,
		listAvailableImageVersions,
	);
	app.get(
		'/device-types/v1/:deviceType/images/:version/download-size',
		identifyMiddleware,
		downloadImageSize,
	);
};

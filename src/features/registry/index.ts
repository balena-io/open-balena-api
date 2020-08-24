import type { Application } from 'express';
import { basicApiKeyAuthenticate } from './middleware';
import { token } from './registry';

export const setup = (app: Application) => {
	app.get('/auth/v1/token', basicApiKeyAuthenticate, token);
};

import type { Application } from 'express';
import { basicApiKeyAuthenticate } from './middleware.js';
import { token } from './registry.js';

export const setup = (app: Application) => {
	app.get('/auth/v1/token', basicApiKeyAuthenticate, token);
};

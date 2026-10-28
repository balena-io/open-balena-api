import type { Application } from 'express';
import { basicApiKeyAuthenticate } from './middleware.ts';
import { token } from './registry.ts';

export const setup = (app: Application) => {
	app.get('/auth/v1/token', basicApiKeyAuthenticate, token);
};

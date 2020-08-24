import type { Application } from 'express';

import { schema } from './schema';

export const setup = (app: Application) => {
	app.get('/config/vars', schema);
};

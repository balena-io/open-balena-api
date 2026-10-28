import type { Application } from 'express';

import { schema } from './schema.ts';

export const setup = (app: Application) => {
	app.get('/config/vars', schema);
};

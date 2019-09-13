import * as express from 'express';
import { memoize } from 'lodash';
import * as randomstring from 'randomstring';

import * as config from '../../src/lib/config';
import supertest = require('./supertest');

export const doLogin = (
	app: express.Express,
	username: string,
	password: string,
) => {
	return supertest(app)
		.post('/login_')
		.send({
			username,
			password,
		})
		.expect(200)
		.then(res => res.text);
};

export const asAdmin = memoize((app: express.Express) => {
	const { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } = config;

	return doLogin(app, SUPERUSER_EMAIL, SUPERUSER_PASSWORD);
});

export const generateApiKey = () => randomstring.generate();

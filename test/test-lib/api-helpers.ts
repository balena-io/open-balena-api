import { expect } from './chai';
import supertest = require('./supertest');

import { app } from '../../init';
import { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } from '../../src/lib/config';
import { User } from '../../src/platform/jwt';

export async function getAdminUser(): Promise<User> {
	const { text: token } = await supertest(app)
		.post('/login_')
		.send({
			username: SUPERUSER_EMAIL,
			password: SUPERUSER_PASSWORD,
		})
		.expect(200);

	expect(token)
		.to.be.a('string')
		.that.has.length.greaterThan(1);

	const { body: user } = await supertest(app, token)
		.get('/user/v1/whoami')
		.expect(200);

	user.token = token;

	return user;
}

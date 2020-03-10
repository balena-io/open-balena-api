import { app } from '../../init';
import * as balenaToken from './balena-token';
import * as fixtures from './fixtures';
import { supertest, UserObjectParam } from './supertest';

export const preInit = async () => {
	await import('./aws-mock');

	// override the interval used to emit the queue stats event...
	const { DeviceOnlineStateManager } = await import(
		'../../src/lib/device-online-state'
	);
	(DeviceOnlineStateManager as any)['QUEUE_STATS_INTERVAL_MSEC'] = 1000;
};

const getAdminUser = async () => {
	// any user we try to create will be the superuser...
	const { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } = await import(
		'../../src/lib/config'
	);

	if (!SUPERUSER_EMAIL || !SUPERUSER_PASSWORD) {
		console.error(
			'SUPERUSER_EMAIL and SUPERUSER_PASSWORD must be set for tests',
		);
		process.exit(1);
	}

	const token = (
		await supertest(app)
			.post('/login_')
			.send({
				username: SUPERUSER_EMAIL,
				password: SUPERUSER_PASSWORD,
			})
			.expect(200)
	).text;

	const adminUser = (await balenaToken.parse(token)) as UserObjectParam;
	adminUser.token = token;

	adminUser.actor = await supertest(app, adminUser)
		.get(`/resin/user(${adminUser.id})`)
		.expect(200)
		.then(res => res.body.d[0].actor as number);

	return adminUser;
};

export const postInit = async () => {
	fixtures.setDefaultFixtures('users', { admin: getAdminUser() });

	await import('../00-init');
};

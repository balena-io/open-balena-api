import * as balenaToken from './balena-token';
import * as fixtures from './fixtures';
import { supertest, UserObjectParam } from './supertest';
import {
	getContractRepos,
	synchronizeContracts,
} from '../../src/features/contracts';

export const preInit = async () => {
	await import('./aws-mock');
	await import('./contracts-mock');

	// override the interval used to emit the queue stats event...
	const { DeviceOnlineStateManager } = await import(
		'../../src/features/device-heartbeat'
	);
	(DeviceOnlineStateManager as any)['QUEUE_STATS_INTERVAL_MSEC'] = 1000;
};

const loadAdminUserAndOrganization = async () => {
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
		await supertest()
			.post('/login_')
			.send({
				username: SUPERUSER_EMAIL,
				password: SUPERUSER_PASSWORD,
			})
			.expect(200)
	).text;

	const user = (await balenaToken.parse(token)) as UserObjectParam;
	user.token = token;
	user.actor = (
		await supertest(user).get(`/resin/user(${user.id})`).expect(200)
	).body.d[0].actor as number;

	const org = (
		await supertest(user)
			.get(
				`/resin/organization?$select=id,name,handle&$filter=handle eq 'admin'`,
			)
			.expect(200)
	).body.d[0];

	return { user, org };
};

export const postInit = async () => {
	await synchronizeContracts(getContractRepos());
	await import('./device-type');

	const { user, org } = await loadAdminUserAndOrganization();
	fixtures.setDefaultFixtures('users', { admin: Promise.resolve(user) });
	fixtures.setDefaultFixtures('organizations', { admin: Promise.resolve(org) });
	await import('../00_init');
};

import * as fixtures from './fixtures.js';
import { supertest, augmentStatusAssertionError } from './supertest.js';
import {
	getContractRepos,
	synchronizeContracts,
} from '../../src/features/contracts/index.js';
import { getUserFromToken } from './api-helpers.js';
import * as config from '../../src/lib/config.js';
import $getObjectMocks from '../fixtures/s3/getObject.json' with { type: 'json' };
import listObjectsV2Mocks from '../fixtures/s3/listObjectsV2.json' with { type: 'json' };
import awsMockSetup from './aws-mock.js';

const version = 'resin';

export const preInit = async () => {
	augmentStatusAssertionError();

	awsMockSetup($getObjectMocks, listObjectsV2Mocks);

	await import('./contracts-mock.js');

	config.TEST_MOCK_ONLY.ASYNC_TASKS_ENABLED = true;
	config.TEST_MOCK_ONLY.ASYNC_TASK_CREATE_SERVICE_INSTALLS_ENABLED = true;
	config.TEST_MOCK_ONLY.PINEJS_QUEUE_INTERVAL_MS = 100;

	// override the interval used to emit the queue stats event...
	const { DeviceOnlineStateManager } =
		await import('../../src/features/device-heartbeat/index.js');
	(DeviceOnlineStateManager as any)['QUEUE_STATS_INTERVAL_MSEC'] = 1000;
};

const loadAdminUserAndOrganization = async () => {
	// any user we try to create will be the superuser...
	const { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } =
		await import('../../src/lib/config.js');

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

	const user = getUserFromToken(token);

	const org = (
		await supertest(user)
			.get(
				`/${version}/organization?$select=id,name,handle&$filter=handle eq 'admin'`,
			)
			.expect(200)
	).body.d[0];

	return { user, org };
};

export const postInit = async () => {
	await synchronizeContracts(getContractRepos());
	(await import('./device-type.js')).loadDefaultFixtures();

	const { user, org } = await loadAdminUserAndOrganization();
	const balenaOsFx = await fixtures.load('00-balena_os');
	fixtures.setDefaultFixtures('users', { admin: Promise.resolve(user) });
	fixtures.setDefaultFixtures('organizations', {
		admin: Promise.resolve(org),
		...Object.fromEntries(
			Object.entries(balenaOsFx.organizations).map(([key, value]) => [
				key,
				Promise.resolve(value),
			]),
		),
	});
	await import('../00_init.js');
};

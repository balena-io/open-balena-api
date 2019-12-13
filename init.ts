import * as _ from 'lodash';
import * as express from 'express';
import { setup } from './src';
import config = require('./config');
import { version } from './package.json';
import { sbvrUtils } from '@resin/pinejs';

async function onInitMiddleware(app: express.Application) {
	const { forwardRequests } = await import('./src/platform/versions');
	forwardRequests(app, 'v5', 'resin');
}

async function onInitModel() {
	const { updateOrInsertModel } = await import('./src/platform');
	const appTypes = await import('./src/lib/application-types');
	const insert = _.cloneDeep(appTypes.Default);
	const filter = { slug: insert.slug };
	delete insert.slug;
	await sbvrUtils.db.transaction(tx =>
		updateOrInsertModel('application_type', filter, insert, tx).then(
			inserted => {
				appTypes.Default.id = inserted.id;
			},
		),
	);
}

async function onInitHooks() {
	const { createAll } = await import('./src/platform/permissions');
	const auth = await import('./src/lib/auth');
	const permissionNames = _.uniq(
		_.flatMap(auth.ROLES).concat(_.flatMap(auth.KEYS, 'permissions')),
	);
	const { setSyncMap, deviceTypes } = await import('./src/lib/device-types');
	setSyncMap({
		name: { name: 'name' },
		cpu_architecture: {
			name: 'arch',
		},
	});

	// this will pre-fetch the device types and populate the cache...
	deviceTypes(sbvrUtils.api.resin);

	return sbvrUtils.db
		.transaction(tx =>
			createAll(tx, permissionNames, auth.ROLES, auth.KEYS, {}),
		)
		.return();
}

async function createSuperuser() {
	const { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } = await import(
		'./src/lib/config'
	);

	if (!SUPERUSER_EMAIL || !SUPERUSER_PASSWORD) {
		return;
	}

	console.log('Creating superuser account...');

	const { registerUser, updatePasswordIfNeeded } = await import(
		'./src/platform/auth'
	);
	const { ConflictError } = sbvrUtils;

	const data = {
		username: 'admin',
		email: SUPERUSER_EMAIL,
		password: SUPERUSER_PASSWORD,
	};

	return sbvrUtils.db
		.transaction(tx =>
			registerUser(data, tx)
				.then(() => {
					console.log('Superuser created successfully!');
				})
				.catch(ConflictError, () => {
					console.log('Superuser already exists!');
					return updatePasswordIfNeeded(data.username, SUPERUSER_PASSWORD).then(
						updated => {
							if (updated) {
								console.log('Superuser password changed.');
							}
						},
					);
				}),
		)
		.catch(err => {
			console.error('Error creating superuser:', err);
		});
}

export const app = express();
app.enable('trust proxy');

const doRunTests = (process.env.RUN_TESTS || '').trim() === '1';

// we have to load some mocks before the app starts...
if (doRunTests) {
	console.log('Loading mocks...');
	import('./test/test-lib/init_mocks');
}

setup(app, {
	config,
	version,
	onInitMiddleware,
	onInitModel,
	onInitHooks,
})
	.tap(createSuperuser)
	.then(({ startServer }) => startServer(process.env.PORT || 1337).return())
	.then(() => {
		if (doRunTests) {
			console.log('Running tests...');
			require('./test/00-init');
		}
	})
	.catch(err => {
		console.error('Failed to initialize:', err);
		process.exit(1);
	});

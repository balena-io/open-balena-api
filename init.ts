import type { ApplicationType } from './src';
import { sbvrUtils, errors, types } from '@balena/pinejs';
import express from 'express';
import _ from 'lodash';
import config = require('./config');
import packageJson from './package.json';
import { promises as fs } from 'fs';
import { TRUST_PROXY, PORT } from './src/lib/config';

const getUrl = (req: express.Request) => req.url;

async function onInitModel() {
	const { updateOrInsertModel } = (
		await import('./src/infra/pinejs-client-helpers/index.js')
	).default;
	const appTypes = (
		await import('./src/features/application-types/application-types.js')
	).default;
	const insert: types.OptionalField<ApplicationType, 'slug'> = _.cloneDeep(
		appTypes.DefaultApplicationType,
	);
	const filter = { slug: insert.slug };
	delete insert.slug;
	await sbvrUtils.db.transaction(async (tx) => {
		const inserted = await updateOrInsertModel(
			'application_type',
			filter,
			insert,
			tx,
		);
		appTypes.DefaultApplicationType.id = inserted.id;
	});
}

async function onInitHooks() {
	const { createAllPermissions: createAll } = (
		await import('./src/infra/auth/permissions.js')
	).default;
	const auth = (await import('./src/lib/auth.js')).default;
	const permissionNames = _.union(
		_.flatMap(auth.ROLES),
		_.flatMap(auth.KEYS, 'permissions'),
	);
	const { setSyncSettings } = (
		await import('./src/features/contracts/index.js')
	).default;
	const { getAccessibleDeviceTypes } = (
		await import('./src/features/device-types/device-types.js')
	).default;

	setSyncSettings({
		'hw.device-type': {
			resource: 'device_type',
			uniqueKey: 'slug',
			includeRawContract: true,
			map: {
				slug: {
					contractField: 'slug',
				},
				name: {
					contractField: 'name',
				},
				logo: {
					contractField: 'assets.logo.url',
				},
				is_of__cpu_architecture: {
					contractField: 'data.arch',
					refersTo: {
						resource: 'cpu_architecture',
						uniqueKey: 'slug',
					},
				},
				device_type_alias: {
					contractField: 'aliases',
					isReferencedBy: {
						resource: 'device_type_alias',
						naturalKeyPart: 'is_referenced_by__alias',
					},
				},
				belongs_to__device_family: {
					contractField: 'data.family',
					refersTo: {
						resource: 'device_family',
						uniqueKey: 'slug',
					},
				},
			},
		},

		'hw.device-family': {
			resource: 'device_family',
			uniqueKey: 'slug',
			map: {
				slug: {
					contractField: 'slug',
				},
				name: {
					contractField: 'name',
				},
				is_manufactured_by__device_manufacturer: {
					contractField: 'data.manufacturedBy',
					refersTo: {
						resource: 'device_manufacturer',
						uniqueKey: 'slug',
					},
				},
			},
		},

		'hw.device-manufacturer': {
			resource: 'device_manufacturer',
			uniqueKey: 'slug',
			map: {
				slug: {
					contractField: 'slug',
				},
				name: {
					contractField: 'name',
				},
			},
		},

		'arch.sw': {
			resource: 'cpu_architecture',
			uniqueKey: 'slug',
			map: {
				slug: {
					contractField: 'slug',
				},
			},
		},
	});

	// Pre-fetch the device types and populate the cache w/o blocking the API startup
	void getAccessibleDeviceTypes(sbvrUtils.api.resin);

	await sbvrUtils.db.transaction((tx) =>
		createAll(tx, permissionNames, auth.ROLES, auth.KEYS, {}),
	);
}

async function createSuperuser() {
	const { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } = (
		await import('./src/lib/config.js')
	).default;

	if (!SUPERUSER_EMAIL || !SUPERUSER_PASSWORD) {
		return;
	}

	console.log('Creating superuser account...');

	const { getOrInsertModelId } = (
		await import('./src/infra/pinejs-client-helpers/index.js')
	).default;

	const { findUser, registerUser, updatePasswordIfNeeded } = (
		await import('./src/infra/auth/auth.js')
	).default;
	const { ConflictError } = errors;

	const data = {
		username: 'admin',
		email: SUPERUSER_EMAIL,
		password: SUPERUSER_PASSWORD,
	};

	try {
		await sbvrUtils.db.transaction(async (tx) => {
			try {
				await registerUser(data, tx);
				console.log('Superuser created successfully!');
			} catch (err) {
				if (err instanceof ConflictError) {
					console.log('Superuser already exists!');
					const updated = await updatePasswordIfNeeded(
						data.username,
						SUPERUSER_PASSWORD,
						tx,
					);
					if (updated) {
						console.log('Superuser password changed.');
					}
				} else {
					throw err;
				}
			}

			const user = await findUser(data.username, tx);
			if (user == null) {
				// can't happen, but need to satisfy the compiler
				return;
			}

			// Create the "superorg" and assign the superuser as the sole member
			const organization = await getOrInsertModelId(
				'organization',
				{ name: user.username, handle: user.username },
				tx,
			);
			await getOrInsertModelId(
				'organization_membership',
				{ user: user.id, is_member_of__organization: organization.id },
				tx,
			);
		});
	} catch (err) {
		console.error('Error creating superuser:', err);
	}
}

export const app = express();
app.set('trust proxy', TRUST_PROXY);

const init = async () => {
	try {
		const generateConfig = (process.env.GENERATE_CONFIG || '').trim();
		if (generateConfig.length > 0) {
			await fs.writeFile(generateConfig, JSON.stringify(config, null, '\t'));
			process.exit();
		}

		const doRunTests =
			(process.env.RUN_TESTS || '').trim() === '1'
				? (await import('./test/test-lib/init-tests.js')).default
				: undefined;

		// we have to load some mocks before the app starts...
		if (doRunTests) {
			console.log('Loading mocks...');
			await doRunTests.preInit();
		}
		const { setup } = (await import('./src/index.js')).default;
		const { startServer } = await setup(app, {
			config,
			version: packageJson.version,
			getUrl,
			onInitModel,
			onInitHooks,
		});
		await createSuperuser();
		await startServer(PORT);
		if (doRunTests) {
			console.log('Running tests...');
			await doRunTests.postInit();
		}
	} catch (err) {
		console.error('Failed to initialize:', err);
		process.exit(1);
	}
};

void init();

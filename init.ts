import type { ApplicationType } from './src/index.js';
import type { types } from '@balena/pinejs';
import { sbvrUtils, errors } from '@balena/pinejs';
import express from 'express';
import _ from 'lodash';
import config from './config.js';
import packageJson from './package.json' with { type: 'json' };
import { promises as fs } from 'fs';
import { TRUST_PROXY, PORT } from './src/lib/config.js';

const getUrl = (req: express.Request) => req.url;

async function onInitModel() {
	const { updateOrInsertModel } =
		await import('./src/infra/pinejs-client-helpers/index.js');
	const appTypes =
		await import('./src/features/application-types/application-types.js');
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
	const { createAllPermissions: createAll } =
		await import('./src/infra/auth/permissions.js');
	const auth = await import('./src/lib/auth.js');
	const permissionNames = _.union(
		Object.values(auth.ROLES).flat(),
		Object.values(auth.KEYS).flatMap((key) => key.permissions),
	);
	const { setSyncSettings } = await import('./src/features/contracts/index.js');
	const { getAccessibleDeviceTypeJsons } =
		await import('./src/features/device-types/device-types.js');

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
	void getAccessibleDeviceTypeJsons(sbvrUtils.api.resin);

	await sbvrUtils.db.transaction((tx) =>
		createAll(tx, permissionNames, auth.ROLES, auth.KEYS, {}),
	);
}

async function createSuperuser() {
	const { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } =
		await import('./src/lib/config.js');

	if (!SUPERUSER_EMAIL || !SUPERUSER_PASSWORD) {
		return;
	}

	console.log('Creating superuser account...');

	const { getOrInsertModelId } =
		await import('./src/infra/pinejs-client-helpers/index.js');

	const { findUser, registerUser, updatePasswordIfNeeded } =
		await import('./src/infra/auth/auth.js');
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
		const generateConfig = (process.env.GENERATE_CONFIG ?? '').trim();
		if (generateConfig.length > 0) {
			await fs.writeFile(generateConfig, JSON.stringify(config, null, '\t'));
			process.exit();
		}

		const doRunTests =
			(process.env.RUN_TESTS ?? '').trim() === '1'
				? await import('./test/test-lib/init-tests.js')
				: undefined;

		// we have to load some mocks before the app starts...
		if (doRunTests) {
			console.log('Loading mocks...');
			await doRunTests.preInit();
		}
		const { setup } = await import('./src/index.js');
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

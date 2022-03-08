import type { ApplicationType } from './src';
import { sbvrUtils, errors, types } from '@balena/pinejs';
import * as express from 'express';
import * as _ from 'lodash';
import config = require('./config');
import { apiRoot } from './src/balena';
import { version } from './package.json';
import { promises as fs } from 'fs';
import { TRUST_PROXY, PORT } from './src/lib/config';

export const EXPOSED_API_VERSION = 'v6';

const getUrl = (req: express.Request) => req.url;

async function onInitMiddleware(initApp: express.Application) {
	const { forwardRequests } = await import('./src/infra/versions');
	forwardRequests(initApp, EXPOSED_API_VERSION, apiRoot);
}

async function onInitModel() {
	const { updateOrInsertModel } = await import(
		'./src/infra/pinejs-client-helpers'
	);
	const appTypes = await import(
		'./src/features/application-types/application-types'
	);
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
	const { createAllPermissions: createAll } = await import(
		'./src/infra/auth/permissions'
	);
	const auth = await import('./src/lib/auth');
	const permissionNames = _.union(
		_.flatMap(auth.ROLES),
		_.flatMap(auth.KEYS, 'permissions'),
	);
	const { setSyncSettings } = await import('./src/features/contracts');
	const { getAccessibleDeviceTypes } = await import(
		'./src/features/device-types/device-types'
	);

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

	// this will pre-fetch the device types and populate the cache...
	getAccessibleDeviceTypes(sbvrUtils.api.resin);

	await sbvrUtils.db.transaction((tx) =>
		createAll(tx, permissionNames, auth.ROLES, auth.KEYS, {}),
	);
}

async function createSuperuser() {
	const { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } = await import(
		'./src/lib/config'
	);

	if (!SUPERUSER_EMAIL || !SUPERUSER_PASSWORD) {
		return;
	}

	console.log('Creating superuser account...');

	const { getOrInsertModelId } = await import(
		'./src/infra/pinejs-client-helpers'
	);

	const { findUser, registerUser, updatePasswordIfNeeded } = await import(
		'./src/infra/auth/auth'
	);
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

export const init = async (configParamter?: any) => {
	try {
		const generateConfig = (process.env.GENERATE_CONFIG || '').trim();
		if (generateConfig.length > 0) {
			await fs.writeFile(
				generateConfig,
				JSON.stringify(configParamter ?? config, null, '\t'),
			);
			process.exit();
		}

		const { setup } = await import('./src');
		const { startServer } = await setup(app, {
			config: configParamter ?? config,
			version,
			getUrl,
			onInitMiddleware,
			onInitModel,
			onInitHooks,
		});
		await createSuperuser();
		return await startServer(PORT);
	} catch (err) {
		console.error('Failed to initialize:', err);
		process.exit(1);
	}
};

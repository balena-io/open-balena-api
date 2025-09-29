import { fileURLToPath } from 'node:url';
import type { types } from '@balena/pinejs';
import { sbvrUtils, permissions } from '@balena/pinejs';
import pProps from 'p-props';
import fs from 'fs';
import _ from 'lodash';
import path from 'path';
import { randomUUID } from 'node:crypto';

import { API_HOST } from '../../src/lib/config.js';
import { supertest } from './supertest.js';
import type { Device, Organization } from '../../src/balena-model.js';
import type Model from '../../src/balena-model.js';
import { assertExists, expectToEventually, waitFor } from './common.js';

const { api } = sbvrUtils;
const version = 'resin';

// Use undefined masquerading as a Tx to pass to functions that "require"
// a Tx based on how they should be used within the main api code, but
// can actually work without one and makes tests life easier
export const fakeTx = undefined as any as Tx;
export const fakeSbvrUtils = undefined as any as typeof sbvrUtils;

type PendingFixtures = types.Dictionary<
	PromiseLike<types.Dictionary<PromiseLike<any>>>
>;
type PartiallyAppliedFixtures = types.Dictionary<
	types.Dictionary<PromiseLike<any>>
>;
export type Fixtures = types.Dictionary<types.Dictionary<any>>;

type LoaderFunc = (
	jsonData: types.AnyObject,
	fixtures: PartiallyAppliedFixtures,
) => PromiseLike<any>;

const logErrorAndThrow = (message: string, ...args: any[]) => {
	console.error(message, ...args);
	throw new Error(message);
};

const createResource = async (args: {
	resource: string;
	method?: string;
	body?: types.AnyObject;
	user?: { token: string };
}) => {
	const { resource, method = 'POST', body = {}, user } = args;
	const headers: HeadersInit = {
		'Content-Type': 'application/json',
	};

	if (user != null) {
		headers.Authorization = `Bearer ${user.token}`;
	}

	const response = await fetch(`http://${API_HOST}/${version}/${resource}`, {
		headers,
		method,
		body: JSON.stringify(body),
	});

	if (response.status !== 201) {
		logErrorAndThrow(
			`Failed to create: ${resource}`,
			response.status,
			await response.text(),
		);
	}

	return await response.json();
};

const loaders: types.Dictionary<LoaderFunc> = {
	applications: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}
		const targetOrgHandle = jsonData.organization ?? 'admin';
		const org = await fixtures.organizations[targetOrgHandle];
		if (org == null) {
			logErrorAndThrow(`Could not find ${targetOrgHandle} org`);
		}

		const body = _.pick(
			jsonData,
			'app_name',
			'should_track_latest_release',
			'application_type',
			'is_public',
			'is_host',
			'is_of__class',
			'uuid',
		);

		const deviceType = await fixtures.deviceTypes[jsonData.device_type];

		return await createResource({
			resource: 'application',
			body: {
				...body,
				organization: org.id,
				is_for__device_type: deviceType.id,
			},
			user,
		});
	},
	application_environment_variables: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const application = await fixtures.applications[jsonData.application];
		if (application == null) {
			logErrorAndThrow(`Could not find application: ${jsonData.application}`);
		}

		const body = _.pick(jsonData, 'name', 'value');

		return await createResource({
			resource: 'application_environment_variable',
			body: {
				...body,
				application: application.id,
			},
			user,
		});
	},
	application_config_variables: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const application = await fixtures.applications[jsonData.application];
		if (application == null) {
			logErrorAndThrow(`Could not find application: ${jsonData.application}`);
		}

		const body = _.pick(jsonData, 'name', 'value');

		return await createResource({
			resource: 'application_config_variable',
			body: {
				...body,
				application: application.id,
			},
			user,
		});
	},
	organizations: async (jsonData: Organization['Write']) => {
		return await api.resin.post({
			resource: 'organization',
			passthrough: { req: permissions.root },
			body: jsonData,
		});
	},
	releases: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const application = await fixtures.applications[jsonData.application];
		if (application == null) {
			logErrorAndThrow(`Could not find application: ${jsonData.application}`);
		}

		if (jsonData.revision > 1) {
			// TODO: Add support for any
			throw new Error('Fixtures do not support using release revision > 1');
		}
		if (jsonData.revision > 0) {
			const lowerRevRelease = await fixtures.releases[jsonData.semver];
			if (lowerRevRelease == null) {
				throw new Error(
					`Could not find release fixture ${jsonData.semver} with revision ${
						jsonData.revision - 1
					} to wait for.`,
				);
			}
		}

		// helper to define a release create order - for application track latest feature.
		if (jsonData.createAfterRelease) {
			await fixtures.releases[jsonData.createAfterRelease];
		}

		const release = await createResource({
			resource: 'release',
			body: {
				belongs_to__application: application.id,
				belongs_to__user: user.id,
				start_timestamp: Date.now(),
				end_timestamp: Date.now(),
				commit: jsonData.commit ?? randomUUID().replace(/-/g, '').toLowerCase(),
				..._.pick(
					jsonData,
					'app_name',
					'status',
					'composition',
					'source',
					'release_version',
					'semver',
					'variant',
					'is_invalidated',
					'is_final',
					'is_passing_tests',
					'known_issue_list',
				),
			},
			user,
		});

		if (jsonData.revision != null && jsonData.revision !== release.revision) {
			throw new Error(
				`Fixture loader failed to properly set revision ${jsonData.revision} to release with semver ${jsonData.semver}`,
			);
		}
		return release;
	},
	release_asset: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}
		const release = await fixtures.releases[jsonData.release];
		if (release == null) {
			logErrorAndThrow(`Could not find release: ${jsonData.release}`);
		}

		let req = supertest(user).post(`/${version}/release_asset`);

		req = req.field('release', release.id);
		req = req.field('asset_key', jsonData.asset_key);
		req = req.attach('asset', Buffer.from([1, 2, 3]), {
			filename: jsonData.asset,
			contentType: 'image/png',
		});

		const res = await req.expect(201);
		return res.body;
	},
	release_tags: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const release = await fixtures.releases[jsonData.release];
		if (release == null) {
			logErrorAndThrow(`Could not find release: ${jsonData.release}`);
		}

		return await createResource({
			resource: 'release_tag',
			body: {
				release: release.id,
				..._.pick(jsonData, 'tag_key', 'value'),
			},
			user,
		});
	},
	images: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		let createdImages = {};

		for await (const r of jsonData.releases) {
			const release = await fixtures.releases[r];
			if (release == null) {
				logErrorAndThrow(`Could not find release: ${r}`);
			}

			const service = await fixtures.services[jsonData.service];
			if (service == null) {
				logErrorAndThrow(`Could not find service: ${jsonData.service}`);
			}

			const body = _.pick(
				jsonData,
				'image_size',
				'project_type',
				'build_log',
				'status',
				'start_timestamp',
				'end_timestamp',
				'push_timestamp',
				'is_stored_at__image_location',
				'content_hash',
			);

			const newImage = await createResource({
				resource: 'image',
				body: {
					...{
						start_timestamp: new Date(),
						end_timestamp: new Date(),
						push_timestamp: new Date(),
						is_stored_at__image_location: '/dev/null',
						is_a_build_of__service: service.id,
					},
					...body,
				},
				user,
			});

			const ipr = await createResource({
				resource: 'image__is_part_of__release',
				body: {
					image: newImage.id,
					is_part_of__release: release.id,
				},
				user,
			});
			newImage.image__is_part_of__release = ipr;
			createdImages = { createdImages, ...newImage };
		}
		return createdImages;
	},
	image_environment_variables: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const image = await fixtures.images[jsonData.image];
		if (image == null) {
			logErrorAndThrow(`Could not find image: ${jsonData.image}`);
		}

		const body = _.pick(jsonData, 'name', 'value');
		const iev = await createResource({
			resource: 'image_environment_variable',
			body: {
				...body,
				release_image: image.image__is_part_of__release.id,
			},
			user,
		});

		return { ...iev, ...{ release_image: image.image__is_part_of__release } };
	},
	image_installs: async (jsonData, fixtures) => {
		const device = await fixtures.devices[jsonData.device];
		if (device == null) {
			logErrorAndThrow('Could not find device: ', jsonData.device);
		}
		const release = await fixtures.releases[jsonData.release];
		if (release == null) {
			logErrorAndThrow('Could not find release: ', jsonData.release);
		}
		const image = await fixtures.images[jsonData.image];
		if (image == null) {
			logErrorAndThrow('Could not find image: ', jsonData.image);
		}
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow('Could not find user: ', jsonData.user);
		}

		return await createResource({
			resource: 'image_install',
			body: {
				installs__image: image.id,
				device: device.id,
				install_date: jsonData.install_date ?? Date.now(),
				download_progress: jsonData.download_progress,
				status: jsonData.status,
				is_provided_by__release: release.id,
			},
			user,
		});
	},
	image_labels: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const image = await fixtures.images[jsonData.image];
		if (image == null) {
			logErrorAndThrow(`Could not find image: ${jsonData.image}`);
		}

		const body = _.pick(jsonData, 'label_name', 'value');

		const imageLabel = await createResource({
			resource: 'image_label',
			body: {
				...body,
				release_image: image.image__is_part_of__release.id,
			},
			user,
		});

		return {
			...imageLabel,
			...{ release_image: image.image__is_part_of__release },
		};
	},
	services: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const application = await fixtures.applications[jsonData.application];
		if (application == null) {
			logErrorAndThrow(`Could not find application: ${jsonData.application}`);
		}

		const body = _.pick(jsonData, 'service_name');

		return await createResource({
			resource: 'service',
			body: {
				...body,
				application: application.id,
			},
			user,
		});
	},
	service_environment_variables: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const service = await fixtures.services[jsonData.service];
		if (service == null) {
			logErrorAndThrow(`Could not find service: ${jsonData.service}`);
		}

		const body = _.pick(jsonData, 'name', 'value');

		return await createResource({
			resource: 'service_environment_variable',
			body: {
				...body,
				service: service.id,
			},
			user,
		});
	},
	service_labels: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const service = await fixtures.services[jsonData.service];
		if (service == null) {
			logErrorAndThrow(`Could not find service: ${jsonData.service}`);
		}

		const body = _.pick(jsonData, 'label_name', 'value');

		return await createResource({
			resource: 'service_label',
			body: {
				...body,
				service: service.id,
			},
			user,
		});
	},

	device_environment_variables: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}
		const device = await fixtures.devices[jsonData.device];
		if (device == null) {
			logErrorAndThrow(`Could not find device: ${jsonData.device}`);
		}

		return await createResource({
			resource: 'device_environment_variable',
			body: {
				device: device.id,
				name: jsonData.name,
				value: jsonData.value,
			},
			user,
		});
	},
	device_service_environment_variables: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const device = await fixtures.devices[jsonData.device];
		if (device == null) {
			logErrorAndThrow(`Could not find device: ${jsonData.device}`);
		}

		const service = await fixtures.services[jsonData.service];
		if (service == null) {
			logErrorAndThrow(`Could not find service: ${jsonData.service}`);
		}

		const si = await expectToEventually(async () => {
			const $si = await api.resin.get({
				resource: 'service_install',
				passthrough: { req: permissions.rootRead },
				id: {
					device: device.id,
					installs__service: service.id,
				},
			});
			assertExists($si);
			return $si;
		});

		return await createResource({
			resource: 'device_service_environment_variable',
			body: {
				service_install: si.id,
				name: jsonData.name,
				value: jsonData.value,
			},
			user,
		});
	},
	devices: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.belongs_to__user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}
		const application =
			await fixtures.applications[jsonData.belongs_to__application];
		if (application == null) {
			logErrorAndThrow(
				`Could not find application: ${jsonData.belongs_to__application}`,
			);
		}

		const deviceType = await fixtures.deviceTypes[jsonData.device_type];

		let release: AnyObject | null = null;
		if (jsonData.is_pinned_on__release != null) {
			// We need to wait for all images to be created
			// This guarantees that all releases are also created and properly
			// linked to its services -> images which finally ensures that
			// all services intalls are properly created for the device
			await Promise.all(Object.values(fixtures.images ?? {}));

			release = await fixtures.releases[jsonData.is_pinned_on__release];
			if (release == null) {
				logErrorAndThrow(
					`Could not find release: ${jsonData.is_pinned_on__release}`,
				);
			}
		}

		return await createResource({
			resource: 'device',
			body: {
				belongs_to__application: application.id,
				belongs_to__user: user.id,
				is_of__device_type: deviceType.id,
				is_pinned_on__release: release?.id ?? null,
				..._.pick(
					jsonData,
					'custom_latitude',
					'custom_longitude',
					'is_online',
					'api_heartbeat_state',
					'latitude',
					'longitude',
					'os_variant',
					'os_version',
					'supervisor_version',
					'overall_progress',
					'provisioning_state',
					'last_connectivity_event',
					'uuid',
				),
			},
			user,
		});
	},

	device_config_variables: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}

		const device = await fixtures.devices[jsonData.device];
		if (device == null) {
			logErrorAndThrow(`Could not find device: ${jsonData.device}`);
		}

		const body = _.pick(jsonData, 'name', 'value');

		return await createResource({
			resource: 'device_config_variable',
			body: {
				...body,
				device: device.id,
			},
			user,
		});
	},
};

const deleteResource =
	(resource: keyof Model) => async (obj: { id: number }) => {
		await api.resin.delete({
			resource,
			id: obj.id,
			passthrough: { req: permissions.root },
		});
	};

// Make sure this list only contains top-level resources, ie. those
// that aren't expected to be cascade deleted by the api itself.
// The order of the properties dictates the order the unloaders run.
const unloaders: Dictionary<(obj: { id: number }) => PromiseLike<void>> = {
	// Devices need to be deleted before their linked hostApp & supervisor releases/apps
	devices: async (device: Pick<Device['Read'], 'id'>) => {
		// Make sure that all service installs are completed before deleting devices
		await waitFor({
			checkFn: async () => {
				const queudSiCreations = await sbvrUtils.api.tasks.get({
					resource: 'task',
					passthrough: { req: permissions.rootRead },
					options: {
						$count: {
							$filter: {
								is_executed_by__handler: 'create_service_installs',
								status: 'queued',
							},
						},
					},
				});
				return queudSiCreations === 0;
			},
		});

		await deleteResource('device')(device);
	},
	applications: deleteResource('application'),
};

export const clean = async (
	fixtures: types.Dictionary<
		types.Dictionary<{ id: number }> | Array<{ id: number }>
	>,
) => {
	if (fixtures == null) {
		throw new Error('You must pass in loaded fixtures to clean');
	}
	for (const [model, unloader] of Object.entries(unloaders)) {
		const objs = fixtures[model];
		if (objs != null) {
			await Promise.all(Object.values(objs).map(unloader));
		}
	}
};

const loadFixtureModel = (
	loader: LoaderFunc,
	fixtures: PendingFixtures,
	data: types.AnyObject,
) => {
	return _.mapValues(data, async (d) => loader(d, await pProps(fixtures)));
};

const defaultFixtures: PendingFixtures = {};

export const setDefaultFixtures = (
	type: string,
	value: types.Dictionary<PromiseLike<any>>,
) => {
	defaultFixtures[type] = Promise.resolve(value);
};

/**
 *
 * @param fixtureName The fixtures to load, when missing only the default fixtures are loaded
 */
export const load = async (fixtureName?: string): Promise<Fixtures> => {
	const fixtures = { ...defaultFixtures };

	if (fixtureName == null) {
		return await pProps(_.mapValues(fixtures, async (fx) => pProps(await fx)));
	}

	const files = await fs.promises.readdir(
		fileURLToPath(new URL(`../fixtures/${fixtureName}`, import.meta.url)),
	);

	const models = files
		.filter(
			(file) =>
				file.endsWith('.json') &&
				Object.hasOwn(loaders, file.slice(0, -'.json'.length)),
		)
		.map((file) => file.slice(0, -'.json'.length).trim());

	for (const model of models) {
		fixtures[model] = (async () => {
			const { default: fromJson } = await import(
				path.join('../fixtures', fixtureName, `${model}.json`),
				{
					with: { type: 'json' },
				}
			);
			return loadFixtureModel(loaders[model], fixtures, fromJson);
		})();
	}

	return await pProps(_.mapValues(fixtures, async (fx) => pProps(await fx)));
};

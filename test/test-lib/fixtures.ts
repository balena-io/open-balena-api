import * as Bluebird from 'bluebird';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';
import * as balenaToken from './balena-token';
import loadPlatform = require('./platform');
import supertest = require('./supertest');

import { app } from '../../init';

import { Tx } from '@resin/pinejs/out/database-layer/db';
import { API_HOST } from '../../src/lib/config';
import { requestAsync } from '../../src/lib/request';

interface AuthUser {
	id: number;
	token: string;
}

interface ApiRequestOpts {
	url: string;
	headers: AnyObject;
	method: string;
	json: boolean;
	body: AnyObject;
}

type Fixtures = Dictionary<PromiseLike<Dictionary<PromiseLike<any>>>>;
type SemiAwaitedFixtures = Dictionary<Dictionary<PromiseLike<any>>>;

type LoaderFunc = (
	jsonData: AnyObject,
	fixtures: SemiAwaitedFixtures,
	tx: Tx,
) => PromiseLike<any>;

// Use undefined masquerading as a Tx to pass to functions that "require"
// a Tx based on how they should be used within the main api code, but
// can actually work without one and makes tests life easier
export const fakeTx = (undefined as any) as Tx;

const buildApiRequestOpts = (args: {
	path: string;
	method?: string;
	body?: AnyObject;
	user?: AuthUser;
}): ApiRequestOpts => {
	const { path, method = 'POST', body = {}, user } = args;
	const headers: AnyObject = { 'X-Forwarded-Proto': 'https' };

	if (user != null) {
		headers.Authorization = `Bearer ${user.token}`;
	}

	return {
		url: `http://${API_HOST}/${path}`,
		headers,
		method,
		json: true,
		body,
	};
};

const logErrorAndThrow = (message: string, ...args: any[]) => {
	console.error(message, ...args);
	throw new Error(message);
};

const awaitFixtures = async (
	fixtures: SemiAwaitedFixtures,
	...dependencies: string[]
) => {
	for (const dependency of dependencies) {
		if (fixtures[dependency]) {
			await Bluebird.props(fixtures[dependency]);
		}
	}
};

const loaders: Dictionary<LoaderFunc> = {};

loaders['application_environment_variables'] = async (jsonData, fixtures) => {
	const application = await fixtures.applications[jsonData.application];
	if (application == null) {
		logErrorAndThrow(`Could not find application: ${jsonData.application}`);
	}
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/application_environment_variable',
		body: {
			application: application.id,
			name: jsonData.name,
			value: jsonData.value,
		},
		user,
	});

	// We depend on `builds` and `service_installs` as device env vars depend on service installs (when converted to service env vars)
	// and those are the two fixtures that can create them
	await awaitFixtures(fixtures, 'builds', 'service_installs');

	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create environment variable', jsonData);
	}
	return body;
};

loaders['application_tags'] = async (jsonData, fixtures) => {
	const application = await fixtures.applications[jsonData.application];
	if (application == null) {
		logErrorAndThrow(`Could not find application: ${jsonData.application}`);
	}
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/application_tag',
		body: {
			application: application.id,
			tag_key: jsonData.tag_key,
			value: jsonData.value,
		},
		user,
	});
	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create application tag', jsonData);
	}
	return body;
};

loaders['applications'] = async (jsonData, fixtures) => {
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/application',
		body: _.pick(
			jsonData,
			'app_name',
			'device_type',
			'depends_on__application',
			'should_track_latest_release',
			'application_type',
		),
		user,
	});

	if (jsonData.depends_on__application != null) {
		const gatewayApp = await fixtures.applications[
			jsonData.depends_on__application
		];
		if (gatewayApp == null) {
			logErrorAndThrow(
				`Could not find application: ${jsonData.depends_on__application}`,
			);
		}
		requestOpts.body.depends_on__application = gatewayApp.id;
	}

	await awaitFixtures(fixtures);
	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create application', jsonData);
	}
	return body;
};

loaders['configs'] = jsonData => {
	const { resinApi, root } = loadPlatform().platform;
	return resinApi.post({
		resource: 'config',
		body: _.pick(jsonData, 'key', 'value', 'scope', 'description'),
		passthrough: { req: root },
	});
};

loaders['device_environment_variables'] = async (jsonData, fixtures) => {
	const device = await fixtures.devices[jsonData.device];
	if (device == null) {
		logErrorAndThrow(`Could not find device: ${jsonData.device}`);
	}
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/device_environment_variable',
		body: {
			device: device.id,
			name: jsonData.name,
			value: jsonData.value,
		},
		user,
	});

	// We depend on `builds` and `service_installs` as device env vars depend on service installs (when converted to service env vars)
	// and those are the two fixtures that can create them
	await awaitFixtures(fixtures, 'builds', 'service_installs');

	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create device environment variable', jsonData);
	}
	return body;
};

loaders['device_tags'] = async (jsonData, fixtures) => {
	const device = await fixtures.devices[jsonData.device];
	if (device == null) {
		logErrorAndThrow(`Could not find device: ${jsonData.device}`);
	}
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/device_tag',
		body: {
			device: device.id,
			tag_key: jsonData.tag_key,
			value: jsonData.value,
		},
		user,
	});
	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create device tag', jsonData);
	}
	return body;
};

loaders['devices'] = async (jsonData, fixtures) => {
	const application = await fixtures.applications[
		jsonData.belongs_to__application
	];
	if (application == null) {
		logErrorAndThrow(
			`Could not find application: ${jsonData.belongs_to__application}`,
		);
	}
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/device',
		body: {
			belongs_to__application: application.id,
			belongs_to__user: user.id,
			..._.pick(
				jsonData,
				'uuid',
				'device_type',
				'is_managed_by__device',
				'os_version',
				'supervisor_version',
				'logs_channel',
			),
		},
		user,
	});
	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create device', jsonData, body);
	}
	return body;
};

loaders['image_environment_variables'] = async (jsonData, fixtures) => {
	const image = await fixtures.images[jsonData.image];
	if (image == null) {
		logErrorAndThrow('Could not find image: ', jsonData.image);
	}
	const release = await fixtures.releases[jsonData.release];
	if (release == null) {
		logErrorAndThrow('Could not find release: ', jsonData.release);
	}
	const user = await fixtures.users['root'];

	// first get the correct image__is_part_of__release id
	const getRequest = buildApiRequestOpts({
		method: 'GET',
		path: `resin/image__is_part_of__release?$select=id&$filter=image eq ${image.id} and is_part_of__release eq ${release.id}`,
		user,
	});
	let [response, body] = await requestAsync(getRequest);

	if (response.statusCode !== 200) {
		logErrorAndThrow(
			'Failed to get image__is_part_of__release resource ',
			jsonData,
		);
	}
	const releaseImage = body.d[0].id;

	const requestOpts = buildApiRequestOpts({
		path: 'resin/image_environment_variable',
		user,
		body: {
			release_image: releaseImage,
			name: jsonData.name,
			value: jsonData.value,
		},
	});
	[response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create image_environment_variable ', jsonData);
	}
	return body;
};

loaders['image_installs'] = async (jsonData, fixtures) => {
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
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/image_install',
		body: {
			installs__image: image.id,
			device: device.id,
			install_date:
				jsonData.install_date != null ? jsonData.install_date : Date.now(),
			download_progress: jsonData.download_progress,
			status: jsonData.status,
			is_provided_by__release: release.id,
		},
		user,
	});

	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create image_install ', jsonData);
	}
	return body;
};

loaders['image_labels'] = async (jsonData, fixtures) => {
	const image = await fixtures.images[jsonData.image];
	if (image == null) {
		logErrorAndThrow('Could not find image: ', jsonData.image);
	}
	const release = await fixtures.releases[jsonData.release];
	if (release == null) {
		logErrorAndThrow('Could not find release: ', jsonData.release);
	}
	const user = await fixtures.users['root'];

	const getRequest = buildApiRequestOpts({
		method: 'GET',
		path: `resin/image__is_part_of__release?$select=id&$filter=image eq ${image.id} and is_part_of__release eq ${release.id}`,
		user,
	});
	let [response, body] = await requestAsync(getRequest);

	if (response.statusCode !== 200 || body.d.length !== 1) {
		logErrorAndThrow(
			'Failed to get image__is_part_of__release resource ',
			jsonData,
		);
	}

	const releaseImage = body.d[0].id;

	const requestOpts = buildApiRequestOpts({
		path: 'resin/image_label',
		user,
		body: {
			release_image: releaseImage,
			label_name: jsonData.label_name,
			value: jsonData.value,
		},
	});
	[response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create image_label ', jsonData);
	}
	return body;
};

loaders['images'] = async (jsonData, fixtures) => {
	const svc = await fixtures.services[jsonData.service];
	if (svc == null) {
		logErrorAndThrow('Could not find service: ', jsonData.service);
	}
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/image',
		body: {
			start_timestamp: Date.now(),
			end_timestamp: Date.now(),
			is_a_build_of__service: svc.id,
			image_size: jsonData.image_size,
			project_type: jsonData.project_type,
			error_message: jsonData.error_message,
			build_log: jsonData.build_log,
			push_timestamp: Date.now(),
			status: jsonData.status,
		},
		user,
	});
	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create image', jsonData);
	}

	if (!_.isEmpty(jsonData.releases)) {
		// setup the image__is_part_of__release resource entries
		await Bluebird.map(jsonData.releases, async (release: string) => {
			const r = await fixtures.releases[release];
			if (r == null) {
				logErrorAndThrow('Could not find release: ', release);
			}

			const requestOpts = buildApiRequestOpts({
				path: 'resin/image__is_part_of__release?returnResource=false',
				body: {
					image: body.id,
					is_part_of__release: r.id,
				},
				user,
			});
			const [response] = await requestAsync(requestOpts);

			if (response.statusCode !== 201) {
				logErrorAndThrow('Failed to add release image link', jsonData);
			}
		});
	}
	return body;
};

loaders['release_tags'] = async (jsonData, fixtures) => {
	const release = await fixtures.releases[jsonData.release];
	if (release == null) {
		logErrorAndThrow(`Could not find release: ${jsonData.release}`);
	}
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/release_tag',
		body: {
			release: release.id,
			tag_key: jsonData.tag_key,
			value: jsonData.value,
		},
		user,
	});
	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create release tag', jsonData);
	}
	return body;
};

loaders['releases'] = async (jsonData, fixtures) => {
	const app = await fixtures.applications[jsonData.application];
	if (app == null) {
		logErrorAndThrow(`Could not find application: ${jsonData.application}`);
	}
	const user = await fixtures.users['root'];

	const finishedStatuses = ['success', 'failed', 'cancelled'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/release',
		body: {
			belongs_to__application: app.id,
			is_created_by__user: user.id,
			commit: jsonData.commit,
			composition: jsonData.composition,
			status: jsonData.status,
			source: jsonData.source,
			build_log: jsonData.build_log,
			start_timestamp: Date.now(),
			end_timestamp: finishedStatuses.includes(jsonData.status)
				? Date.now()
				: null,
			update_timestamp: Date.now(),
		},
		user,
	});
	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create release', jsonData);
	}
	return body;
};

loaders['service_installs'] = async (jsonData, fixtures) => {
	const service = await fixtures.services[jsonData.service];
	if (service == null) {
		logErrorAndThrow('Could not find service: ', jsonData.service);
	}
	const device = await fixtures.devices[jsonData.device];
	if (device == null) {
		logErrorAndThrow('Could not find device: ', jsonData.device);
	}
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/service_install',
		body: {
			installs__service: service.id,
			device: device.id,
		},
		user,
	});
	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create service_install ', jsonData);
	}
	return body;
};

loaders['service_labels'] = async (jsonData, fixtures) => {
	const service = await fixtures.services[jsonData.service];
	if (service == null) {
		logErrorAndThrow('Could not find service: ', jsonData.service);
	}
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/service_label',
		body: {
			service: service.id,
			label_name: jsonData.label_name,
			value: jsonData.value,
		},
		user,
	});
	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create service_label ', jsonData);
	}
	return body;
};

loaders['services'] = async (jsonData, fixtures) => {
	const app = await fixtures.applications[jsonData.application];
	if (app == null) {
		logErrorAndThrow('Could not find application: ', jsonData.application);
	}
	const user = await fixtures.users['root'];

	const requestOpts = buildApiRequestOpts({
		path: 'resin/service',
		body: {
			service_name: jsonData.service_name,
			application: app.id,
		},
		user,
	});
	const [response, body] = await requestAsync(requestOpts);

	if (response.statusCode !== 201) {
		logErrorAndThrow('Failed to create service', jsonData);
	}
	return body;
};

loaders['users'] = async (_jsonData: AnyObject) => {
	// any user we try to create will be the superuser...
	const { SUPERUSER_EMAIL, SUPERUSER_PASSWORD } = await import(
		'../../src/lib/config'
	);

	if (!SUPERUSER_EMAIL || !SUPERUSER_PASSWORD) {
		return;
	}

	const token = await supertest(app)
		.post('/login_')
		.send({
			username: SUPERUSER_EMAIL,
			password: SUPERUSER_PASSWORD,
		})
		.expect(200)
		.then(res => {
			return res.text;
		});

	const user = (await balenaToken.parse(token)) as AnyObject & { id: number };
	user.token = token;

	user.actor = await supertest(app, user)
		.get(`/resin/user(${user.id})`)
		.expect(200)
		.then(res => res.body.d[0].actor as number);

	return user;
};

const unloaders: Dictionary<(obj: { id: number }) => PromiseLike<void>> = {};

const deleteResinResource = (resource: string) => (obj: { id: number }) => {
	const { resinApi, root } = loadPlatform().platform;
	return resinApi
		.delete({
			resource,
			id: obj.id,
			passthrough: { req: root },
		})
		.catch(_.noop)
		.return();
};

unloaders['applications'] = deleteResinResource('application');
unloaders['configs'] = deleteResinResource('config');
unloaders['devices'] = deleteResinResource('device');

const moduleUnloadOrder = ['configs', 'devices', 'applications'];

export const clean = async (fixtures: AnyObject) => {
	const sortedModules = _(fixtures)
		.keys()
		.filter(model => unloaders[model] != null)
		.sortBy(model => moduleUnloadOrder.indexOf(model))
		.value();

	for (const model of sortedModules) {
		const objs = fixtures[model];
		const unloader = unloaders[model];
		// This needs to be in serial right now because cascading deletes may
		// cause issues where the deletes interact via the cascading, eg in
		// the case of deleting two users where one deletes user -> user
		// membership app access and the other user -> application -> user
		// membership app access
		await Bluebird.mapSeries(_.values(objs), unloader);
	}
};

const loadFixtureModel = (
	loader: LoaderFunc,
	fixtures: Fixtures,
	data: AnyObject,
	tx: Tx,
) => {
	return _.mapValues(data, async d =>
		loader(d, await Bluebird.props(fixtures), tx),
	);
};

export type FixtureData = Dictionary<Dictionary<any>>;

export const load = async (fixtureName: string): Promise<FixtureData> => {
	const files = await fs.promises.readdir(
		path.resolve(__dirname, '../fixtures', fixtureName),
	);

	const models = files
		.filter(
			file =>
				file.endsWith('.json') && file.slice(0, -'.json'.length) in loaders,
		)
		.map(file => file.slice(0, -'.json'.length).trim());

	return loadPlatform().platform.db.transaction(tx => {
		const fixtures: Fixtures = {};
		models.forEach(model => {
			fixtures[model] = import(
				path.join('../fixtures', fixtureName, `${model}.json`)
			).then(fromJson =>
				loadFixtureModel(loaders[model], fixtures, fromJson, tx),
			);
		});

		// always load the root user...
		fixtures['users'] = Promise.resolve(
			loadFixtureModel(loaders['users'], fixtures, { root: {} }, tx),
		);

		return Bluebird.props(_.mapValues(fixtures, fx => Bluebird.props(fx)));
	});
};

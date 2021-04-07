import { sbvrUtils, permissions } from '@balena/pinejs';
import * as Bluebird from 'bluebird';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';
import * as uuid from 'uuid';

import { Headers } from 'request';
import { API_HOST } from '../../src/lib/config';
import { requestAsync } from '../../src/infra/request-promise';
import { version } from './versions';

const { api } = sbvrUtils;

type PendingFixtures = Dictionary<PromiseLike<Dictionary<PromiseLike<any>>>>;
type PartiallyAppliedFixtures = Dictionary<Dictionary<PromiseLike<any>>>;
export type Fixtures = Dictionary<Dictionary<any>>;

type LoaderFunc = (
	jsonData: AnyObject,
	fixtures: PartiallyAppliedFixtures,
) => PromiseLike<any>;

const logErrorAndThrow = (message: string, ...args: any[]) => {
	console.error(message, ...args);
	throw new Error(message);
};

const createResource = async (args: {
	resource: string;
	method?: string;
	body?: AnyObject;
	user?: { token: string };
}) => {
	const { resource, method = 'POST', body = {}, user } = args;
	const headers: Headers = { 'X-Forwarded-Proto': 'https' };

	if (user != null) {
		headers.Authorization = `Bearer ${user.token}`;
	}

	const [response, responseBody] = await requestAsync({
		url: `http://${API_HOST}/${version}/${resource}`,
		headers,
		method,
		json: true,
		body,
	});

	if (response.statusCode !== 201) {
		logErrorAndThrow(
			`Failed to create: ${resource}`,
			response.statusCode,
			responseBody,
		);
	}

	return responseBody;
};

const loaders: Dictionary<LoaderFunc> = {
	applications: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}
		const org = await fixtures.organizations['admin'];
		if (org == null) {
			logErrorAndThrow('Could not find admin org');
		}

		if (jsonData.depends_on__application != null) {
			const gatewayApp = await fixtures.applications[
				jsonData.depends_on__application
			];
			if (gatewayApp == null) {
				logErrorAndThrow(
					`Could not find application: ${jsonData.depends_on__application}`,
				);
			}
			jsonData.depends_on__application = gatewayApp.id;
		}

		const body = _.pick(
			jsonData,
			'app_name',
			'device_type',
			'depends_on__application',
			'should_track_latest_release',
			'application_type',
			'is_public',
			'is_host',
		);

		return await createResource({
			resource: 'application',
			body: {
				...body,
				organization: org.id,
			},
			user,
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

		return await createResource({
			resource: 'release',
			body: {
				belongs_to__application: application.id,
				belongs_to__user: user.id,
				start_timestamp: Date.now(),
				end_timestamp: Date.now(),
				commit: jsonData.commit ?? uuid.v4().replace(/\-/g, '').toLowerCase(),
				..._.pick(
					jsonData,
					'app_name',
					'status',
					'composition',
					'source',
					'release_version',
					'release_type',
					'is_passing_tests',
				),
			},
			user,
		});
	},
	devices: async (jsonData, fixtures) => {
		const user = await fixtures.users[jsonData.belongs_to__user];
		if (user == null) {
			logErrorAndThrow(`Could not find user: ${jsonData.user}`);
		}
		const application = await fixtures.applications[
			jsonData.belongs_to__application
		];
		if (application == null) {
			logErrorAndThrow(
				`Could not find application: ${jsonData.belongs_to__application}`,
			);
		}

		return await createResource({
			resource: 'device',
			body: {
				belongs_to__application: application.id,
				belongs_to__user: user.id,
				is_of__device_type: (await fixtures.deviceTypes[jsonData.device_type])
					.id,
				..._.pick(
					jsonData,
					'custom_latitude',
					'custom_longitude',
					'is_managed_by__device',
					'is_online',
					'latitude',
					'logs_channel',
					'longitude',
					'os_variant',
					'os_version',
					'supervisor_version',
					'uuid',
				),
			},
			user,
		});
	},
};

const deleteResource = (resource: string) => async (obj: { id: number }) => {
	await api.resin.delete({
		resource,
		id: obj.id,
		passthrough: { req: permissions.root },
	});
};

const modelUnloadOrder = ['devices', 'applications', 'releases'];

const unloaders: {
	[K in typeof modelUnloadOrder[number]]: (obj: {
		id: number;
	}) => PromiseLike<void>;
} = {
	devices: deleteResource('device'),
	applications: deleteResource('application'),
	releases: deleteResource('release'),
};

export const clean = async (fixtures: AnyObject) => {
	for (const model of modelUnloadOrder) {
		const objs = fixtures[model];
		if (objs != null) {
			await Promise.all(Object.values(objs).map(unloaders[model]));
		}
	}
};

const loadFixtureModel = (
	loader: LoaderFunc,
	fixtures: PendingFixtures,
	data: AnyObject,
) => {
	return _.mapValues(data, async (d) =>
		loader(d, await Bluebird.props(fixtures)),
	);
};

const defaultFixtures: PendingFixtures = {};

export const setDefaultFixtures = (
	type: string,
	value: Dictionary<PromiseLike<any>>,
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
		return await Bluebird.props(
			_.mapValues(fixtures, (fx) => Bluebird.props(fx)),
		);
	}

	const files = await fs.promises.readdir(
		path.resolve(__dirname, '../fixtures', fixtureName),
	);

	const models = files
		.filter(
			(file) =>
				file.endsWith('.json') &&
				loaders.hasOwnProperty(file.slice(0, -'.json'.length)),
		)
		.map((file) => file.slice(0, -'.json'.length).trim());

	models.forEach((model) => {
		fixtures[model] = import(
			path.join('../fixtures', fixtureName, `${model}.json`)
		).then((fromJson) => loadFixtureModel(loaders[model], fixtures, fromJson));
	});

	return await Bluebird.props(
		_.mapValues(fixtures, (fx) => Bluebird.props(fx)),
	);
};

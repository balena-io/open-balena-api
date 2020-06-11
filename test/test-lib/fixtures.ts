import { sbvrUtils } from '@resin/pinejs';
import * as Bluebird from 'bluebird';
import * as fs from 'fs';
import * as _ from 'lodash';
import * as path from 'path';

import { Tx } from '@resin/pinejs/out/database-layer/db';
import { Headers } from 'request';
import { API_HOST } from '../../src/lib/config';
import { requestAsync } from '../../src/lib/request';

const { api, root } = sbvrUtils;

type PendingFixtures = Dictionary<PromiseLike<Dictionary<PromiseLike<any>>>>;
type PartiallyAppliedFixtures = Dictionary<Dictionary<PromiseLike<any>>>;
export type Fixtures = Dictionary<Dictionary<any>>;

type LoaderFunc = (
	jsonData: AnyObject,
	fixtures: PartiallyAppliedFixtures,
	tx: Tx,
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
		url: `http://${API_HOST}/resin/${resource}`,
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

		return createResource({
			resource: 'application',
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
	},
	'supervisor-release': async (jsonData, fixtures) => {
		const user = await fixtures.users['admin'];

		const deviceType = await fixtures.deviceTypes[jsonData.is_for__device_type];
		if (deviceType == null) {
			logErrorAndThrow(
				'Could not find device type: ',
				jsonData.is_for__device_type,
			);
		}

		const isPublic = jsonData.is_public || false;

		return createResource({
			resource: 'supervisor_release',
			body: {
				image_name: jsonData.image_name,
				supervisor_version: jsonData.supervisor_version,
				is_for__device_type: deviceType.id,
				is_public: isPublic,
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

		return createResource({
			resource: 'device',
			body: {
				belongs_to__application: application.id,
				belongs_to__user: user.id,
				is_of__device_type: (await fixtures.deviceTypes[jsonData.device_type])
					.id,
				..._.pick(
					jsonData,
					'uuid',
					'is_managed_by__device',
					'os_version',
					'supervisor_version',
					'logs_channel',
					'custom_latitude',
					'custom_longitude',
					'os_variant',
					'os_version',
					'supervisor_version',
					'is_online',
					'latitude',
					'longitude',
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
		passthrough: { req: root },
	});
};

const modelUnloadOrder = ['applications'] as const;
const unloaders: {
	[K in typeof modelUnloadOrder[number]]: (obj: {
		id: number;
	}) => PromiseLike<void>;
} = {
	applications: deleteResource('application'),
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
	tx: Tx,
) => {
	return _.mapValues(data, async (d) =>
		loader(d, await Bluebird.props(fixtures), tx),
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
		return Bluebird.props(_.mapValues(fixtures, (fx) => Bluebird.props(fx)));
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

	return sbvrUtils.db.transaction((tx) => {
		models.forEach((model) => {
			fixtures[model] = import(
				path.join('../fixtures', fixtureName, `${model}.json`)
			).then((fromJson) =>
				loadFixtureModel(loaders[model], fixtures, fromJson, tx),
			);
		});

		return Bluebird.props(_.mapValues(fixtures, (fx) => Bluebird.props(fx)));
	});
};

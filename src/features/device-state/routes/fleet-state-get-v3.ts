import type { RequestHandler } from 'express';
import type { Request } from 'express';

import * as _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling';
import { readTransaction } from '../state-get-utils';
import { Expand } from 'pinejs-client-core';

import { sbvrUtils, errors } from '@balena/pinejs';
import {
	buildAppFromRelease,
	getConfig,
	releaseExpand,
	StateV3,
} from './state-get-v3';
const { api } = sbvrUtils;
const { UnauthorizedError } = errors;

type FleetStateV3 = {
	[uuid: string]: Omit<StateV3[string], 'is_managed_by__device' | 'apps'> & {
		apps: {
			[uuid: string]: Omit<
				StateV3[string]['apps'][string],
				'is_managed_by__device'
			>;
		};
	};
};

const fleetExpand: Expand = {
	application_config_variable: {
		$select: ['name', 'value'],
		$orderby: {
			name: 'asc',
		},
	},
	application_environment_variable: {
		$select: ['name', 'value'],
	},
	should_be_running__release: releaseExpand,
	service: {
		$select: ['id', 'service_name'],
		$expand: {
			service_environment_variable: {
				$select: ['name', 'value'],
			},
			service_label: {
				$select: ['label_name', 'value'],
			},
			is_built_by__image: {
				$select: ['id', 'is_stored_at__image_location'],
			},
		},
	},
};

const stateQuery = _.once(() =>
	api.resin.prepare<{ uuid: string }>({
		resource: 'application',
		id: { uuid: { '@': 'uuid' } },
		options: {
			$expand: {
				...fleetExpand,
			},
		},
	}),
);

const releaseQuery = _.once(() =>
	api.resin.prepare<{ commit: string }>({
		resource: 'release',
		options: {
			$filter: {
				commit: { '@': 'commit' },
			},
			...releaseExpand,
		},
	}),
);

const getFleet = async (req: Request, uuid: string) => {
	const fleet = await readTransaction((tx) =>
		stateQuery()({ uuid }, undefined, { req, tx }),
	);

	if (!fleet) {
		throw new UnauthorizedError();
	}

	return fleet;
};

const getReleaseForCommit = async (req: Request, commit: string) => {
	const release = await readTransaction((tx) =>
		releaseQuery()({ commit }, undefined, { req, tx }),
	);

	if (!release) {
		throw new UnauthorizedError();
	}

	return release[0] ?? {};
};

const getReleaseForFleet = (fleet: AnyObject): AnyObject | undefined => {
	if (fleet.should_be_running__release[0] != null) {
		return fleet.should_be_running__release[0];
	}
};

const getFleetAppsForState = (
	fleet: AnyObject,
	release: AnyObject | undefined,
	config: Dictionary<string>,
): FleetStateV3[string]['apps'] => {
	return {
		[fleet.uuid]: {
			id: fleet.id,
			name: fleet.app_name,
			is_host: fleet.is_host,
			class: fleet.is_of__class,
			...(release != null && {
				releases: buildAppFromRelease(undefined, fleet, release, config),
			}),
		},
	};
};

const getFleetStateV3 = async (
	req: Request,
	uuid: string,
	releaseUuid: string | undefined = undefined,
): Promise<FleetStateV3> => {
	const fleet = await getFleet(req, uuid);
	const config = getConfig(undefined, fleet);
	let release: AnyObject | undefined;
	if (releaseUuid) {
		release = await getReleaseForCommit(req, releaseUuid);
	} else {
		release = getReleaseForFleet(fleet);
	}
	const apps = getFleetAppsForState(fleet, release, config);

	const state: FleetStateV3 = {
		[uuid]: {
			name: fleet.app_name,
			apps,
			config,
		},
	};
	return state;
};

export const fleetStateV3: RequestHandler = async (req, res) => {
	const { fleetUuid, releaseUuid } = req.params;
	if (!fleetUuid) {
		return res.status(400).end();
	}

	try {
		const state = await getFleetStateV3(req, fleetUuid, releaseUuid);
		res.json(state);
	} catch (err) {
		if (handleHttpErrors(req, res, err)) {
			return;
		}
		captureException(err, 'Error getting default flee state', { req });
		res.status(500).end();
	}
};

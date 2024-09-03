import type { RequestHandler } from 'express';
import type { Request } from 'express';

import _ from 'lodash';
import {
	captureException,
	handleHttpErrors,
} from '../../../infra/error-handling/index.js';

import { sbvrUtils, errors } from '@balena/pinejs';
import { getConfig, readTransaction } from '../state-get-utils.js';
import type { StateV3 } from './state-get-v3.js';
import { buildAppFromRelease, releaseExpand } from './state-get-v3.js';
const { api } = sbvrUtils;
const { UnauthorizedError } = errors;

type FleetStateV3 = {
	[uuid: string]: Omit<StateV3[string], 'apps'> & {
		apps: {
			[uuid: string]: StateV3[string]['apps'][string];
		};
	};
};

const fleetExpand = {
	application_config_variable: {
		$select: ['name', 'value'],
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
} as const;

const stateQuery = _.once(() =>
	api.resin.prepare(
		{
			resource: 'application',
			id: { uuid: { '@': 'uuid' } },
			options: {
				$expand: fleetExpand,
			},
		} as const,
		{ uuid: ['string'] },
	),
);

const releaseQuery = _.once(() =>
	api.resin.prepare(
		{
			resource: 'release',
			options: {
				$filter: {
					commit: { '@': 'commit' },
					belongs_to__application: { '@': 'fleetId' },
					status: 'success',
				},
				...releaseExpand,
			},
		} as const,
		{ commit: ['string'], fleetId: ['number'] },
	),
);

const getFleet = async (req: Request, uuid: string) => {
	const fleet = await readTransaction((tx) =>
		stateQuery()({ uuid }, undefined, { req, tx }),
	);

	if (fleet == null) {
		throw new UnauthorizedError();
	}
	return fleet;
};

const getSuccessfulReleaseForFleetAndCommit = async (
	req: Request,
	commit: string,
	fleetId: number,
) => {
	const [release] = await readTransaction((tx) =>
		releaseQuery()({ commit, fleetId }, undefined, { req, tx }),
	);

	if (release == null) {
		throw new UnauthorizedError();
	}

	return release;
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
		release = await getSuccessfulReleaseForFleetAndCommit(
			req,
			releaseUuid,
			fleet.id,
		);
	} else {
		release = fleet.should_be_running__release[0];
	}
	const apps = getFleetAppsForState(fleet, release, config);

	return {
		[uuid]: {
			name: fleet.app_name,
			apps,
			config,
		},
	};
};

export const fleetStateV3: RequestHandler = async (req, res) => {
	const { fleetUuid } = req.params;
	const { releaseUuid } = req.query;

	if (!fleetUuid) {
		return res.status(400).end();
	}

	if (releaseUuid && typeof releaseUuid !== 'string') {
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

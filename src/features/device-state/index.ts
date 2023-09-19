import type { Application, Request } from 'express';
import type StrictEventEmitter from 'strict-event-emitter-types';

import { EventEmitter } from 'events';
import { middleware } from '../../infra/auth';
import type { Device } from '../../balena-model';

import { resolveOrDenyDevicesWithStatus } from './middleware';
import { stateV2 } from './routes/state-get-v2';
import { stateV3 } from './routes/state-get-v3';
import { statePatchV2 } from './routes/state-patch-v2';
import {
	StatePatchV3Body,
	resolveDeviceUuids,
	statePatchV3,
} from './routes/state-patch-v3';
import { fleetStateV3 } from './routes/fleet-state-get-v3';
import type { GetStateEventStoredDeviceFields } from './state-get-utils';

export {
	getStateEventAdditionalFields,
	getConfig,
	setReadTransaction,
	filterDeviceConfig,
	formatImageLocation,
	addDefaultConfigVariableFn,
	setDefaultConfigVariables,
	getReleaseForDevice,
	serviceInstallFromImage,
} from './state-get-utils';
export {
	metricsPatchFields,
	v2ValidPatchFields,
	v3ValidPatchFields,
} from './state-patch-utils';

const gracefulGet = resolveOrDenyDevicesWithStatus(304);

export const setup = (app: Application) => {
	app.get(
		'/device/v2/:uuid/state',
		gracefulGet,
		middleware.authenticated,
		stateV2,
	);
	app.get(
		'/device/v3/:uuid/state',
		gracefulGet,
		middleware.authenticated,
		stateV3,
	);
	app.patch(
		'/device/v2/:uuid/state',
		resolveOrDenyDevicesWithStatus({ deleted: 200, frozen: 401 }),
		middleware.authenticatedApiKey,
		statePatchV2,
	);
	app.patch(
		'/device/v3/state',
		resolveOrDenyDevicesWithStatus(401, (req) =>
			resolveDeviceUuids(req.body as StatePatchV3Body),
		),
		middleware.authenticatedApiKey,
		statePatchV3,
	);
	app.get(
		'/device/v3/fleet/:fleetUuid/state',
		middleware.authenticated,
		fleetStateV3,
	);
};

export interface Events {
	'get-state': (
		deviceId: number,
		info: Pick<Request, 'apiKey'> & {
			config?: Dictionary<string>;
			ipAddress: string | undefined;
			// TODO: Drop in the next major
			/** @deprecated use the storedDeviceFields */
			storedPublicAddress: Device['public_address'];
			storedDeviceFields: GetStateEventStoredDeviceFields;
		},
	) => void;
}
export const events: StrictEventEmitter<EventEmitter, Events> =
	new EventEmitter();

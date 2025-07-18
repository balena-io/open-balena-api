import type { Application, Request } from 'express';
import type { StrictEventEmitter } from 'strict-event-emitter-types';

import { EventEmitter } from 'events';
import { middleware } from '../../infra/auth/index.js';

import { resolveOrDenyDevicesWithStatus } from './middleware.js';
import { stateV2 } from './routes/state-get-v2.js';
import { stateV3 } from './routes/state-get-v3.js';
import { statePatchV2 } from './routes/state-patch-v2.js';
import type { StatePatchV3Body } from './routes/state-patch-v3.js';
import { resolveDeviceUuids, statePatchV3 } from './routes/state-patch-v3.js';
import { fleetStateV3 } from './routes/fleet-state-get-v3.js';
import type { Device } from '../../balena-model.js';

export {
	getStateEventAdditionalFields,
	getConfig,
	setReadTransaction,
	filterDeviceConfig,
	formatImageLocation,
	addDefaultConfigVariableFn,
	setDefaultConfigVariables,
	serviceInstallFromImage,
} from './state-get-utils.js';
export {
	metricsPatchFields,
	v2ValidPatchFields,
	v3ValidPatchFields,
	truncateConstrainedFieldsFactory,
} from './state-patch-utils.js';

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
			storedDeviceFields: Partial<Device['Read']>;
		},
	) => void;
}
export const events: StrictEventEmitter<EventEmitter, Events> =
	new EventEmitter();

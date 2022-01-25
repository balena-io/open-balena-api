import type { Application, Request } from 'express';
import type StrictEventEmitter from 'strict-event-emitter-types';

import { EventEmitter } from 'events';
import { apiKeyMiddleware } from '../../infra/auth';

import { resolveOrGracefullyDenyDevices } from './middleware';
import { stateV2 } from './routes/state-get-v2';
import { statePatchV2 } from './routes/state-patch-v2';

export { setReadTransaction } from './routes/state-get-v2';
export {
	filterDeviceConfig,
	formatImageLocation,
	addDefaultConfigVariableFn,
	setDefaultConfigVariables,
	getReleaseForDevice,
	serviceInstallFromImage,
} from './state-get-utils';
export {
	metricsPatchFields,
	v2ValidPatchFields as validPatchFields,
} from './state-patch-utils';

export const setup = (app: Application) => {
	app.get(
		'/device/v2/:uuid/state',
		resolveOrGracefullyDenyDevices,
		apiKeyMiddleware,
		stateV2,
	);
	app.patch(
		'/device/v2/:uuid/state',
		resolveOrGracefullyDenyDevices,
		apiKeyMiddleware,
		statePatchV2,
	);
};

export interface Events {
	'get-state': (uuid: string, req: Pick<Request, 'apiKey'>) => void;
}
export const events: StrictEventEmitter<EventEmitter, Events> =
	new EventEmitter();

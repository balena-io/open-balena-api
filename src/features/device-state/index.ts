import type { Application, Request } from 'express';
import type StrictEventEmitter from 'strict-event-emitter-types';

import { EventEmitter } from 'events';
import { apiKeyMiddleware } from '../../infra/auth';

import { resolveOrGracefullyDenyDevices } from './middleware';
import { stateV2 } from './routes/state';
import { statePatch } from './routes/state-patch';

export { setReadTransaction } from './routes/state';
export {
	filterDeviceConfig,
	formatImageLocation,
	setMinPollInterval,
	getReleaseForDevice,
	serviceInstallFromImage,
	metricsPatchFields,
	validPatchFields,
} from './utils';

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
		statePatch,
	);
};

export interface Events {
	'get-state': (uuid: string, req: Pick<Request, 'apiKey'>) => void;
}
export const events: StrictEventEmitter<EventEmitter, Events> =
	new EventEmitter();

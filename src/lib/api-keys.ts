import * as _ from 'lodash';

import { createApiKey, PartialCreateKey } from '../platform/api-keys';

export const createProvisioningApiKey: PartialCreateKey = _.partial(
	createApiKey,
	'application',
	'provisioning-api-key',
);
export const createDeviceApiKey: PartialCreateKey = _.partial(
	createApiKey,
	'device',
	'device-api-key',
);
export const createNamedUserApiKey: PartialCreateKey = _.partial(
	createApiKey,
	'user',
	'named-user-api-key',
);

// Deprecated
export const createUserApiKey: PartialCreateKey = _.partial(
	createApiKey,
	'user',
	'user-api-key',
);

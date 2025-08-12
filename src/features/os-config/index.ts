import type { Application } from 'express';

import {
	DEVICE_CONFIG_OPENVPN_CA,
	DEVICE_CONFIG_OPENVPN_CONFIG,
	DEVICE_CONFIG_SSH_AUTHORIZED_KEYS,
	DEVICE_CONFIG_SSH_AUTHORIZED_KEYS_EMPTY_OVERRIDE,
	LOGS_HOST,
} from '../../lib/config.js';
import { b64decode } from '../../lib/utils.js';

// OS service configurations
const services = {
	openvpn: {
		config: DEVICE_CONFIG_OPENVPN_CONFIG,
		ca: b64decode(DEVICE_CONFIG_OPENVPN_CA),
	},
	ssh: {
		authorized_keys: DEVICE_CONFIG_SSH_AUTHORIZED_KEYS,
	},
};

// Config.json migrations: Changes should be evaluated for security risks before applying.
//
// - A field may not be deleted from config.json.
// - A field with a value of non-null tells os-config that the value will be updated
//   to the new value if it's different.
// - A field not found in the whitelist of the os-config schema will be ignored.
const config = {
	overrides: {
		...(LOGS_HOST != null && { logsEndpoint: `https://${LOGS_HOST}` }),
	},
};

export const setup = (app: Application) => {
	app.get('/os/v1/config/', (req, res) => {
		// Clear SSH authorized keys if authorization header is present
		// This mechanism is an heuristic to determine balenaOS version >= 6.1.0
		// If it is, it can use a temporary JIT SSH key and don't require this one to to be set
		// This behaviour can be activated by setting the DEVICE_CONFIG_SSH_AUTHORIZED_KEYS_EMPTY_OVERRIDE environment variable to `true`
		// We can't completely remove `ssh` from the services otherwise it won't pass schema verification done by `os-config`
		const servicesOverride =
			DEVICE_CONFIG_SSH_AUTHORIZED_KEYS_EMPTY_OVERRIDE &&
			req.headers.authorization
				? { ...services, ssh: { authorized_keys: '' } }
				: services;

		res.json({
			services: servicesOverride,
			// Older os-configs don't know how to handle the config field, but
			// luckily serde-rs ignores unknown fields by default.
			config,
			/** @deprecated schema_version is an outdated field kept for compatibility with legacy os-configs */
			schema_version: '1.0.0',
		});
	});
};

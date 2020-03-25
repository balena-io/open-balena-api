import type { RequestHandler } from 'express';

import {
	DEVICE_CONFIG_OPENVPN_CA,
	DEVICE_CONFIG_OPENVPN_CONFIG,
	DEVICE_CONFIG_SSH_AUTHORIZED_KEYS,
} from '../lib/config';
import { b64decode } from '../lib/utils';

export const getOsConfiguration: RequestHandler = (_req, res) => {
	res.json({
		services: {
			openvpn: {
				config: DEVICE_CONFIG_OPENVPN_CONFIG,
				ca: b64decode(DEVICE_CONFIG_OPENVPN_CA),
			},
			ssh: {
				authorized_keys: DEVICE_CONFIG_SSH_AUTHORIZED_KEYS,
			},
		},
		schema_version: '1.0.0',
	});
};

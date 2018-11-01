import Express = require('express');
import { b64decode } from '../lib/utils';
import {
	DEVICE_CONFIG_OPENVPN_CA,
	DEVICE_CONFIG_OPENVPN_CONFIG,
	DEVICE_CONFIG_SSH_AUTHORIZED_KEYS,
} from '../lib/config';

export const getOsConfiguration = (
	_req: Express.Request,
	res: Express.Response,
) => {
	res.json({
		services: {
			openvpn: {
				config: b64decode(DEVICE_CONFIG_OPENVPN_CONFIG),
				ca: b64decode(DEVICE_CONFIG_OPENVPN_CA),
			},
			ssh: {
				authorized_keys: DEVICE_CONFIG_SSH_AUTHORIZED_KEYS,
			},
		},
		schema_version: '1.0.0',
	});
};

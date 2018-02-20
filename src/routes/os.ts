import Express = require('express');
import { b64decode } from '../lib/utils';

const { env } = process;

export const getOsConfiguration = (
	_req: Express.Request,
	res: Express.Response,
) => {
	res.json({
		services: {
			openvpn: {
				config: b64decode(env.DEVICE_CONFIG_OPENVPN_CONFIG || ''),
				ca: b64decode(env.DEVICE_CONFIG_OPENVPN_CA || ''),
			},
			ssh: {
				authorized_keys: env.DEVICE_CONFIG_SSH_AUTHORIZED_KEYS || '',
			},
		},
		schema_version: '1.0.0',
	});
};

import type { ConfigLoader } from '@balena/pinejs';
import * as balenaModel from './src/balena';

export = {
	models: [balenaModel],
	users: [
		{
			username: 'guest',
			password: ' ',
			permissions: [
				// The "1 eq 1" is necessary so that we can do "device_type/canAccess()"
				'resin.device_type.read?1 eq 1',
				'resin.device_type_alias.read',
				'resin.cpu_architecture.read',
				'resin.device_family.read',
				'resin.device_manufacturer.read',
			],
		},
	],
} as ConfigLoader.Config;

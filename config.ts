import type { ConfigLoader } from '@balena/pinejs';
import * as balenaModel from './src/balena';

export = {
	models: [balenaModel],
	users: [
		{
			username: 'guest',
			password: ' ',
			permissions: [
				'resin.device_type.read',
				'resin.device_type_alias.read',
				'resin.cpu_architecture.read',
				'resin.device_family.read',
				'resin.device_manufacturer.read',
			],
		},
	],
} as ConfigLoader.Config;

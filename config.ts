import type { ConfigLoader } from '@resin/pinejs';
import * as balenaModel from './src/balena';

export = {
	models: [balenaModel],
	users: [
		{
			username: 'guest',
			password: ' ',
			permissions: ['resin.device_type.get'],
		},
	],
} as ConfigLoader.Config;

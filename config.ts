import type { ConfigLoader } from '@balena/pinejs';
import * as balenaModel from './src/balena';

export = {
	models: [balenaModel],
	users: [
		{
			username: 'guest',
			password: ' ',
			permissions: ['resin.device_type.read'],
		},
	],
} as ConfigLoader.Config;

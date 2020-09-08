import type { ConfigLoader } from '@balena/pinejs';
import * as balenaModel from './src/balena';

export = {
	models: [balenaModel],
	users: [
		{
			username: 'guest',
			password: ' ',
			permissions: ['resin.device_type.read', 'resin.cpu_architecture.read'],
		},
	],
} as ConfigLoader.Config;

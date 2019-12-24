import { Config } from '@resin/pinejs/out/config-loader/config-loader';
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
} as Config;

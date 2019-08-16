import { Config } from '@resin/pinejs/out/config-loader/config-loader';
import * as resinModel from './src/resin';

export = {
	models: [resinModel],
	users: [
		{
			username: 'guest',
			password: ' ',
			permissions: ['resin.device_type.get'],
		},
	],
} as Config;

import type { ConfigLoader } from '@balena/pinejs';
import { model as balenaModel } from './src/balena.ts';
import {
	v6AbstractSqlModel,
	getV6Translations,
	toVersion as v6ToVersion,
} from './src/translations/v6/v6.ts';
import {
	v7AbstractSqlModel,
	getV7Translations,
	toVersion as v7ToVersion,
} from './src/translations/v7/v7.ts';
import { getFileUploadHandler } from './src/fileupload-handler.ts';

export default {
	models: [
		balenaModel,
		{
			apiRoot: 'v7',
			modelName: 'v7',
			abstractSql: v7AbstractSqlModel,
			translateTo: v7ToVersion,
			translations: getV7Translations(),
		},
		{
			apiRoot: 'v6',
			modelName: 'v6',
			abstractSql: v6AbstractSqlModel,
			translateTo: v6ToVersion,
			translations: getV6Translations(),
		},
	],
	users: [
		{
			username: 'guest',
			password: ' ',
			// No direct permissions: the guest user gets them from the `guest` role
			// (`ROLES.guest` in src/lib/auth.ts), which `createAllPermissions` keeps
			// in sync on startup, including removing stale ones
		},
	],
	webResourceHandler: getFileUploadHandler(),
} as ConfigLoader.Config;

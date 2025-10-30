import type { ConfigLoader } from '@balena/pinejs';
import { model as balenaModel } from './src/balena.js';
import {
	v6AbstractSqlModel,
	getV6Translations,
	toVersion as v6ToVersion,
} from './src/translations/v6/v6.js';
import {
	v7AbstractSqlModel,
	getV7Translations,
	toVersion as v7ToVersion,
} from './src/translations/v7/v7.js';
import { getFileUploadHandler } from './src/fileupload-handler.js';

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
			permissions: [
				// core model permissions
				'resin.cpu_architecture.read',
				'resin.device_type.read',
				'resin.device_type_alias.read',
				'resin.device_family.read',
				'resin.device_manufacturer.read',
				// public application & hostApp permissions
				'resin.application.read?is_public and is_for__device_type/canAccess()',
				'resin.release.read?belongs_to__application/any(a:a/is_public and is_for__device_type/canAccess())',
				'resin.service.read?application/any(a:a/is_public and is_for__device_type/canAccess())',
				'resin.image.read?is_a_build_of__service/any(s:s/application/any(a:a/is_public and is_for__device_type/canAccess()))',
				'resin.application_tag.read?application/any(a:a/is_public and is_for__device_type/canAccess())',
				'resin.release_tag.read?release/any(r:r/belongs_to__application/any(a:a/is_public and is_for__device_type/canAccess()))',
				'resin.image__is_part_of__release.read?is_part_of__release/any(r:r/belongs_to__application/any(a:a/is_public and is_for__device_type/canAccess()))',
				'resin.release_asset.read?release/canAccess()',
			],
		},
	],
	webResourceHandler: getFileUploadHandler(),
} as ConfigLoader.Config;

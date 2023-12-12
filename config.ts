import type { ConfigLoader } from '@balena/pinejs';
import * as balenaModel from './src/balena';
import { v6AbstractSqlModel, v6Translations } from './src/translations/v6/v6';
import { getFileUploadHandler } from './src/fileupload-handler';

export = {
	models: [
		balenaModel,
		{
			apiRoot: 'v6',
			modelName: 'v6',
			abstractSql: v6AbstractSqlModel,
			translateTo: 'resin',
			translations: v6Translations,
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
				'resin.application.read?is_public eq true and is_for__device_type/canAccess()',
				'resin.release.read?belongs_to__application/any(a:a/is_public eq true and is_for__device_type/canAccess())',
				'resin.service.read?application/any(a:a/is_public eq true and is_for__device_type/canAccess())',
				`resin.image.read?is_a_build_of__service/any(s:s/application/any(a:a/is_public eq true and is_for__device_type/canAccess()))`,
				'resin.application_tag.read?application/any(a:a/is_public eq true and is_for__device_type/canAccess())',
				'resin.release_tag.read?release/any(r:r/belongs_to__application/any(a:a/is_public eq true and is_for__device_type/canAccess()))',
				`resin.image__is_part_of__release.read?is_part_of__release/any(r:r/belongs_to__application/any(a:a/is_public eq true and is_for__device_type/canAccess()))`,
			],
		},
	],
	webResourceHandler: getFileUploadHandler(),
} as ConfigLoader.Config;

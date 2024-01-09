import type { ConfigLoader } from '@balena/pinejs';

import {
	aliasFields,
	aliasTable,
	generateAbstractSqlModel,
	overrideFieldType,
	renameResourceField,
} from '../../abstract-sql-utils';
import * as userHasDirectAccessToApplication from '../../features/applications/models/user__has_direct_access_to__application';

export const toVersion = 'resin';

export const v6AbstractSqlModel = generateAbstractSqlModel(
	__dirname + '/v6.sbvr',
);

aliasTable(v6AbstractSqlModel, 'application', 'my application');
userHasDirectAccessToApplication.addToModel(v6AbstractSqlModel);

overrideFieldType(v6AbstractSqlModel, 'release', 'version', 'JSON');

// Convert concept type fields to integer since that's how they were treated in v6 and below (before ConceptType was correctly treated as a reference field)
overrideFieldType(v6AbstractSqlModel, 'user', 'actor', 'Integer');
overrideFieldType(v6AbstractSqlModel, 'device', 'actor', 'Integer');
overrideFieldType(v6AbstractSqlModel, 'application', 'actor', 'Integer');

for (const resource of ['device', 'application']) {
	renameResourceField(v6AbstractSqlModel, resource, 'env var name', 'name');
}

export const getV6Translations = (abstractSqlModel = v6AbstractSqlModel) =>
	({
		'my application': {
			$toResource: `application$${toVersion}`,
			abstractSql: [
				'SelectQuery',
				[
					'Select',
					aliasFields(abstractSqlModel, 'application', {
						'depends on-application': ['Cast', ['Null'], 'Integer'],
					}),
				],
				[
					'From',
					['Alias', ['Resource', `application$${toVersion}`], 'application'],
				],
				[
					'Where',
					[
						'Exists',
						[
							'SelectQuery',
							['Select', []],
							[
								'From',
								[
									'Alias',
									[
										'Resource',
										`user-has direct access to-application$${toVersion}`,
									],
									'user-has direct access to-application',
								],
							],
							[
								'Where',
								[
									'Equals',
									[
										'ReferencedField',
										'user-has direct access to-application',
										'has direct access to-application',
									],
									['ReferencedField', 'application', 'id'],
								],
							],
						],
					],
				],
			],
		},
		application: {
			'depends on-application': ['Cast', ['Null'], 'Integer'],
		},
		'application-has-name': {
			$toResource: `application-has-config var name$${toVersion}`,
		},
		'device-has-name': {
			$toResource: `device-has-config var name$${toVersion}`,
		},
		device: {
			'is managed by-device': ['Cast', ['Null'], 'Integer'],
			'logs channel': ['Cast', ['Null'], 'Short Text'],
			'vpn address': ['Cast', ['Null'], 'Short Text'],
		},
		release: {
			abstractSql: [
				'SelectQuery',
				[
					'Select',
					aliasFields(abstractSqlModel, 'release', {
						'release type': [
							'Case',
							[
								'When',
								['ReferencedField', 'release', 'is final'],
								['EmbeddedText', 'final'],
							],
							['Else', ['EmbeddedText', 'draft']],
						],
						contract: [
							'Cast',
							[
								'ToJSON',
								['Cast', ['ReferencedField', 'release', 'contract'], 'Text'],
							],
							'Text',
						],
					}),
				],
				['From', ['Alias', ['Resource', `release$${toVersion}`], 'release']],
			],
		},
		'image-is downloaded by-device': {
			// TODO-HACK: This redirects to the device resource as a hack because we can't redirect to no resource,
			// but the redirect is only used for modification events and we have no allowlist entries for gateway_download
			// writes so it should be blocked anyway
			$toResource: `device$${toVersion}`,
			abstractSql: [
				'SelectQuery',
				[
					'Select',
					[
						['Alias', ['Cast', ['Null'], 'Integer'], 'id'],
						['Alias', ['Cast', ['Null'], 'Date'], 'created at'],
						['Alias', ['Cast', ['Null'], 'Integer'], 'is downloaded by-device'],
						['Alias', ['Cast', ['Null'], 'Short Text'], 'status'],
						['Alias', ['Cast', ['Null'], 'Integer'], 'download progress'],
						['Alias', ['Cast', ['Null'], 'Integer'], 'image'],
					],
				],
				['Where', ['Boolean', false]],
			],
		},
	}) satisfies ConfigLoader.Model['translations'];

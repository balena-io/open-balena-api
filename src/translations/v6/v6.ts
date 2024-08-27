import type { ConfigLoader } from '@balena/pinejs';
import {
	aliasFields,
	aliasTable,
	generateAbstractSqlModel,
	overrideFieldType,
	renameResourceField,
} from '../../abstract-sql-utils.js';
import * as userHasDirectAccessToApplication from '../../features/applications/models/user__has_direct_access_to__application.js';
import * as DeviceAdditions from '../../features/devices/models/device-additions.js';

export const toVersion = 'v7';

export const v6AbstractSqlModel = generateAbstractSqlModel(
	new URL('v6.sbvr', import.meta.url),
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

export const getV6Translations = (abstractSqlModel = v6AbstractSqlModel) => {
	const deviceFieldSet = new Set(
		abstractSqlModel.tables['device'].fields.map((f) => f.fieldName),
	);
	return {
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
			// W/o skipping v7 w/ a direct `$resin` translation, POSTs fail with a 500 with:
			// TypeError: Cannot read properties of undefined (reading 'idField')
			// TODO: Try removing or switching `$resin` to `$${toVersion}` after v gets fixed
			// See: https://github.com/balena-io/pinejs/issues/794
			$toResource: `application-has-config var name$resin`,
		},
		'device-has-name': {
			// W/o skipping v7 w/ a direct `$resin` translation, POSTs fail with a 500 with:
			// TypeError: Cannot read properties of undefined (reading 'idField')
			// TODO: Try removing or switching `$resin` to `$${toVersion}` after v gets fixed
			// See: https://github.com/balena-io/pinejs/issues/794
			$toResource: `device-has-config var name$resin`,
		},
		device: {
			'is managed by-device': ['Cast', ['Null'], 'Integer'],
			'logs channel': ['Cast', ['Null'], 'Short Text'],
			'vpn address': ['Cast', ['Null'], 'Short Text'],
			'should be running-release': 'is pinned on-release',
			// We are redefining the overall_status rather than translating it, so that:
			// • the v6 overall_status performances does not degrades from the additional FROMs
			// • the behavior does not change if we later add new statuses in the v7 one
			'overall status': [
				'Case',
				[
					'When',
					DeviceAdditions.isInactiveFn(!deviceFieldSet.has('is active')),
					['EmbeddedText', 'inactive'],
				],
				[
					'When',
					DeviceAdditions.isPostProvisioning,
					['EmbeddedText', 'post-provisioning'],
				],
				[
					'When',
					DeviceAdditions.isPreProvisioning,
					['EmbeddedText', 'configuring'],
				],
				['When', DeviceAdditions.isOverallOffline, ['EmbeddedText', 'offline']],
				[
					'When',
					[
						'And',
						['Exists', ['ReferencedField', 'device', 'download progress']],
						[
							'Equals',
							['ReferencedField', 'device', 'status'],
							['EmbeddedText', 'Downloading'],
						],
					],
					['EmbeddedText', 'updating'],
				],
				[
					'When',
					['Exists', ['ReferencedField', 'device', 'provisioning progress']],
					['EmbeddedText', 'configuring'],
				],
				[
					'When',
					[
						'Exists',
						[
							'SelectQuery',
							['Select', []],
							[
								'From',
								[
									'Alias',
									// The `Resource`+$bypass avoids adding extra permissions checks,
									// similarly to how `Table` is working in the balena model.
									// Without it, requests that have permissions to access the device resource,
									// but do not have permissions to access image_installs would start failing.
									['Resource', `device-installs-image$${toVersion}$bypass`],
									'image install',
								],
							],
							[
								'Where',
								[
									'And',
									[
										'Equals',
										['ReferencedField', 'image install', 'device'],
										['ReferencedField', 'device', 'id'],
									],
									[
										'Exists',
										['ReferencedField', 'image install', 'download progress'],
									],
									[
										'Equals',
										['ReferencedField', 'image install', 'status'],
										['EmbeddedText', 'Downloading'],
									],
								],
							],
						],
					],
					['EmbeddedText', 'updating'],
				],
				['Else', ['EmbeddedText', 'idle']],
			],
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
	} satisfies ConfigLoader.Model['translations'];
};

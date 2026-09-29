import type {
	AbstractSqlModel,
	EqualsNode,
	ExistsNode,
	SelectQueryNode,
} from '@balena/abstract-sql-compiler';

const CATALOG_TABLE = 'application-catalogs-profile name';

const belongsToSameApplication: EqualsNode = [
	'Equals',
	['ReferencedField', 'r', 'belongs to-application'],
	['ReferencedField', 'application profile catalog', 'application'],
];

const isSuccessful: EqualsNode = [
	'Equals',
	['ReferencedField', 'r', 'status'],
	['EmbeddedText', 'success'],
];

const carriesThisProfile: ExistsNode = [
	'Exists',
	[
		'SelectQuery',
		['Select', []],
		['From', ['Alias', ['Table', 'image-is part of-release'], 'ri']],
		[
			'Where',
			[
				'And',
				[
					'Equals',
					['ReferencedField', 'ri', 'is part of-release'],
					['ReferencedField', 'r', 'id'],
				],
				[
					'Exists',
					[
						'SelectQuery',
						['Select', []],
						['From', ['Alias', ['Table', 'image profile'], 'ip']],
						[
							'Where',
							[
								'And',
								[
									'Equals',
									['ReferencedField', 'ip', 'release image'],
									['ReferencedField', 'ri', 'id'],
								],
								[
									'Equals',
									['ReferencedField', 'ip', 'profile name'],
									[
										'ReferencedField',
										'application profile catalog',
										'catalogs-profile name',
									],
								],
							],
						],
					],
				],
			],
		],
	],
];

// The earliest (by semver) successful release whose images carry this
// catalog entry's profile name - ie. the release that first introduced
// the profile to the application. A computed foreign key: typed as a
// real FK to `release` (so it's $expand-able like one), but backed by
// this correlated subquery instead of a stored/migrated column - same
// mechanism `device.should_be_running__release` uses (device-additions.ts).
const firstReleaseDefinition: SelectQueryNode = [
	'SelectQuery',
	['Select', [['ReferencedField', 'r', 'id']]],
	['From', ['Alias', ['Table', 'release'], 'r']],
	[
		'Where',
		['And', belongsToSameApplication, isSuccessful, carriesThisProfile],
	],
	[
		'OrderBy',
		['ASC', ['ReferencedField', 'r', 'semver major']],
		['ASC', ['ReferencedField', 'r', 'semver minor']],
		['ASC', ['ReferencedField', 'r', 'semver patch']],
		['ASC', ['ReferencedField', 'r', 'revision']],
	],
	['Limit', ['Number', 1]],
];

export const addToModel = (abstractSql: AbstractSqlModel) => {
	abstractSql.tables[CATALOG_TABLE].fields.push({
		fieldName: 'first release',
		dataType: 'ForeignKey',
		references: {
			resourceName: 'release',
			fieldName: 'id',
		},
		computed: {
			parallel: 'SAFE',
			volatility: 'STABLE',
			definition: firstReleaseDefinition,
		},
	});
};

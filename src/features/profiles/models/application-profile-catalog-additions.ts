import type {
	AbstractSqlModel,
	SelectQueryNode,
} from '@balena/abstract-sql-compiler';

// SELECT "r"."id"
// FROM "release" AS "r"
// WHERE "r"."belongs to-application" = "application profile catalog"."application"
// AND "r"."status" = 'success'
// AND EXISTS (
// 	SELECT 1
// 	FROM "image-is part of-release" AS "ri"
// 	WHERE "ri"."is part of-release" = "r"."id"
// 	AND EXISTS (
// 		SELECT 1
// 		FROM "image profile" AS "ip"
// 		WHERE "ip"."release image" = "ri"."id"
// 		AND "ip"."profile name" = "application profile catalog"."catalogs-profile name"
// 	)
// )
// ORDER BY "r"."semver major" ASC, "r"."semver minor" ASC, "r"."semver patch" ASC,
// 	"r"."revision" ASC, "r"."variant" DESC, "r"."created at" ASC
// LIMIT 1
const availableSinceReleaseDefinition: SelectQueryNode = [
	'SelectQuery',
	['Select', [['ReferencedField', 'r', 'id']]],
	['From', ['Alias', ['Table', 'release'], 'r']],
	[
		'Where',
		[
			'And',
			[
				'Equals',
				['ReferencedField', 'r', 'belongs to-application'],
				['ReferencedField', 'application profile catalog', 'application'],
			],
			[
				'Equals',
				['ReferencedField', 'r', 'status'],
				['EmbeddedText', 'success'],
			],
			[
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
			],
		],
	],
	[
		'OrderBy',
		['ASC', ['ReferencedField', 'r', 'semver major']],
		['ASC', ['ReferencedField', 'r', 'semver minor']],
		['ASC', ['ReferencedField', 'r', 'semver patch']],
		['ASC', ['ReferencedField', 'r', 'revision']],
		// prefer prod over dev
		['DESC', ['ReferencedField', 'r', 'variant']],
		['ASC', ['ReferencedField', 'r', 'created at']],
	],
	['Limit', ['Number', 1]],
];

export const addToModel = (abstractSql: AbstractSqlModel) => {
	abstractSql.tables['application-catalogs-profile name'].fields.push({
		fieldName: 'available since-release',
		dataType: 'ForeignKey',
		references: {
			resourceName: 'release',
			fieldName: 'id',
		},
		computed: {
			parallel: 'SAFE',
			volatility: 'STABLE',
			definition: availableSinceReleaseDefinition,
		},
	});

	abstractSql.relationships['application-catalogs-profile name'][
		'available since'
	] = {
		release: {
			$: ['available since-release', ['release', 'id']],
		},
	};
};

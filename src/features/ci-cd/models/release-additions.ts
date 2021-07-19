import type {
	AbstractSqlModel,
	CastNode,
	ConcatenateNode,
	ExistsNode,
} from '@balena/abstract-sql-compiler';

export const addToModel = (abstractSql: AbstractSqlModel) => {
	const isFinal: ExistsNode = [
		'Exists',
		['ReferencedField', 'release', 'revision'],
	];

	abstractSql.tables['release'].fields.push({
		fieldName: 'is final',
		dataType: 'Boolean',
		required: true,
		computed: isFinal,
	});

	const semverField: ConcatenateNode = [
		'Concatenate',
		['ReferencedField', 'release', 'semver major'],
		['EmbeddedText', '.'],
		['ReferencedField', 'release', 'semver minor'],
		['EmbeddedText', '.'],
		['ReferencedField', 'release', 'semver patch'],
	];

	abstractSql.tables['release'].fields.push({
		fieldName: 'semver',
		dataType: 'Short Text',
		required: true,
		computed: semverField,
	});

	const createdAtTimestamp: CastNode = [
		'Cast',
		[
			'Floor',
			[
				'Multiply',
				['Totalseconds', ['ReferencedField', 'release', 'created at']],
				['Number', 1000],
			],
		],
		'Text',
	];

	abstractSql.tables['release'].fields.push({
		fieldName: 'version',
		dataType: 'JSON',
		required: true,
		computed: [
			'Concatenate',
			['EmbeddedText', '{'],

			['EmbeddedText', '"raw": "'],
			semverField,
			[
				'Cast',
				[
					'Case',
					[
						'When',
						['NotExists', ['ReferencedField', 'release', 'revision']],
						['Concatenate', ['EmbeddedText', '-'], createdAtTimestamp],
					],
					[
						'When',
						[
							'Equals',
							['ReferencedField', 'release', 'revision'],
							['Number', 0],
						],
						['EmbeddedText', ''],
					],
					[
						'Else',
						[
							'Concatenate',
							['EmbeddedText', '+rev'],
							['ReferencedField', 'release', 'revision'],
						],
					],
				],
				'Text',
			],
			['EmbeddedText', '",'],

			['EmbeddedText', '"major":'],
			['ReferencedField', 'release', 'semver major'],
			['EmbeddedText', ','],

			['EmbeddedText', '"minor":'],
			['ReferencedField', 'release', 'semver minor'],
			['EmbeddedText', ','],

			['EmbeddedText', '"patch":'],
			['ReferencedField', 'release', 'semver patch'],
			['EmbeddedText', ','],

			['EmbeddedText', '"prerelease": ['],
			[
				'Cast',
				[
					'Case',
					['When', isFinal, ['EmbeddedText', '']],
					['Else', createdAtTimestamp],
				],
				'Text',
			],
			['EmbeddedText', '],'],

			['EmbeddedText', '"build": ['],
			[
				'Cast',
				[
					'Case',
					[
						'When',
						[
							'And',
							isFinal,
							[
								'GreaterThan',
								['ReferencedField', 'release', 'revision'],
								['Number', 0],
							],
						],
						[
							'Concatenate',
							['EmbeddedText', '"rev'],
							['ReferencedField', 'release', 'revision'],
							['EmbeddedText', '"'],
						],
					],
					['Else', ['EmbeddedText', '']],
				],
				'Text',
			],
			['EmbeddedText', '],'],

			['EmbeddedText', '"version": "'],
			semverField,
			[
				'Cast',
				[
					'Case',
					['When', isFinal, ['EmbeddedText', '']],
					['Else', ['Concatenate', ['EmbeddedText', '-'], createdAtTimestamp]],
				],
				'Text',
			],
			['EmbeddedText', '"'],
			['EmbeddedText', '}'],
		],
	});
};

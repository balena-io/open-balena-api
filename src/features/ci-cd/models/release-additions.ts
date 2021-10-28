import type {
	AbstractSqlModel,
	CastNode,
	ReferencedFieldNode,
	ExistsNode,
} from '@balena/abstract-sql-compiler';
import { oneLineTrimSqlConcat } from '../../../abstract-sql-utils';

export const addToModel = (abstractSql: AbstractSqlModel) => {
	const [revisionField, majorField, minorField, patchField] = [
		'revision',
		'semver major',
		'semver minor',
		'semver patch',
	].map((field): ReferencedFieldNode => ['ReferencedField', 'release', field]);

	const isFinal: ExistsNode = ['Exists', revisionField];
	abstractSql.tables['release'].fields.push({
		fieldName: 'is final',
		dataType: 'Boolean',
		required: true,
		computed: isFinal,
	});

	const semverField = oneLineTrimSqlConcat`${majorField}.${minorField}.${patchField}`;
	abstractSql.tables['release'].fields.push({
		fieldName: 'semver',
		dataType: 'Short Text',
		required: true,
		computed: semverField,
	});

	const createdAtTimestampNode: CastNode = [
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

	const rawVersionField = oneLineTrimSqlConcat`${semverField}${[
		'Cast',
		[
			'Case',
			[
				'When',
				['NotExists', revisionField],
				oneLineTrimSqlConcat`-${createdAtTimestampNode}`,
			],
			[
				'When',
				['GreaterThan', revisionField, ['Number', 0]],
				oneLineTrimSqlConcat`+rev${revisionField}`,
			],
			['Else', ['EmbeddedText', '']],
		],
		'Text',
	]}`;

	abstractSql.tables['release'].fields.push(
		{
			fieldName: 'raw version',
			dataType: 'Short Text',
			required: true,
			computed: rawVersionField,
		},
		{
			fieldName: 'version',
			dataType: 'JSON',
			required: true,
			computed: oneLineTrimSqlConcat`{
			"raw": "${rawVersionField}",
			"major": ${majorField},
			"minor": ${minorField},
			"patch": ${patchField},
			"prerelease": [${[
				'Cast',
				[
					'Case',
					['When', isFinal, ['EmbeddedText', '']],
					['Else', createdAtTimestampNode],
				],
				'Text',
			]}],
			"build": [${[
				'Cast',
				[
					'Case',
					[
						'When',
						['GreaterThan', revisionField, ['Number', 0]],
						oneLineTrimSqlConcat`"rev${revisionField}"`,
					],
					['Else', ['EmbeddedText', '']],
				],
				'Text',
			]}],
			"version": "${semverField}${[
				'Cast',
				[
					'Case',
					['When', isFinal, ['EmbeddedText', '']],
					['Else', oneLineTrimSqlConcat`-${createdAtTimestampNode}`],
				],
				'Text',
			]}"
		}`,
		},
	);
};

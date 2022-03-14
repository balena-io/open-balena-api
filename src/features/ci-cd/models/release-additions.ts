import type {
	AbstractSqlModel,
	BooleanTypeNodes,
	CastNode,
	ReferencedFieldNode,
	ExistsNode,
	NotExistsNode,
} from '@balena/abstract-sql-compiler';
import {
	joinTextParts,
	oneLineTrimSqlConcat,
	splitStringParts,
} from '../../../abstract-sql-utils';

export const addToModel = (abstractSql: AbstractSqlModel) => {
	const [
		revisionField,
		majorField,
		minorField,
		patchField,
		prereleaseField,
		buildField,
	] = [
		'revision',
		'semver major',
		'semver minor',
		'semver patch',
		'semver prerelease',
		'semver build',
	].map((field): ReferencedFieldNode => ['ReferencedField', 'release', field]);

	const hasPrerelease: BooleanTypeNodes = [
		'NotEquals',
		prereleaseField,
		['EmbeddedText', ''],
	];
	const hasBuild: BooleanTypeNodes = [
		'NotEquals',
		buildField,
		['EmbeddedText', ''],
	];
	const isDraft: NotExistsNode = ['NotExists', revisionField];
	const isFinal: ExistsNode = ['Exists', revisionField];
	const revN = oneLineTrimSqlConcat`rev${revisionField}`;

	abstractSql.tables['release'].fields.push({
		fieldName: 'is final',
		dataType: 'Boolean',
		required: true,
		computed: isFinal,
	});

	const versionCore = oneLineTrimSqlConcat`${majorField}.${minorField}.${patchField}`;
	const semverField = oneLineTrimSqlConcat`${versionCore}${[
		'Cast',
		[
			'Case',
			['When', hasPrerelease, oneLineTrimSqlConcat`-${prereleaseField}`],
			['Else', ['EmbeddedText', '']],
		],
		'Text',
	]}${[
		'Cast',
		[
			'Case',
			['When', hasBuild, oneLineTrimSqlConcat`+${buildField}`],
			['Else', ['EmbeddedText', '']],
		],
		'Text',
	]}`;
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

	const versionCoreAndPrerelease = oneLineTrimSqlConcat`${versionCore}${joinTextParts(
		'-',
		[hasPrerelease, prereleaseField],
		'.',
		[isDraft, createdAtTimestampNode],
	)}`;

	const hasNotAlreadyInBuildPositiveRevision: BooleanTypeNodes = [
		'And',
		['GreaterThan', revisionField, ['Number', 0]],
		[
			'Not',
			[
				'Like',
				oneLineTrimSqlConcat`.${buildField}.`,
				oneLineTrimSqlConcat`%.${revN}.%`,
			],
		],
	];

	const rawVersionField = oneLineTrimSqlConcat`${versionCoreAndPrerelease}${joinTextParts(
		'+',
		[hasBuild, buildField],
		'.',
		[hasNotAlreadyInBuildPositiveRevision, revN],
	)}`;

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
			"prerelease": [${joinTextParts(
				'',
				[hasPrerelease, splitStringParts(prereleaseField)],
				',',
				[isDraft, createdAtTimestampNode],
			)}],
			"build": [${joinTextParts('', [hasBuild, splitStringParts(buildField)], ',', [
				hasNotAlreadyInBuildPositiveRevision,
				oneLineTrimSqlConcat`"${revN}"`,
			])}],
			"version": "${versionCoreAndPrerelease}"
		}`,
		},
	);
};

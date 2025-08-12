import type {
	AbstractSqlModel,
	BooleanTypeNodes,
	CastNode,
	FieldNode,
	ExistsNode,
	NotExistsNode,
} from '@balena/abstract-sql-compiler';
import {
	joinTextParts,
	joinTextPartsAndPrefix,
	oneLineTrimSqlConcat,
	splitStringParts,
} from '../../../abstract-sql-utils.js';

export const addToModel = (abstractSql: AbstractSqlModel) => {
	const [
		revisionField,
		majorField,
		minorField,
		patchField,
		prereleaseField,
		buildField,
		variantField,
	] = [
		'revision',
		'semver major',
		'semver minor',
		'semver patch',
		'semver prerelease',
		'semver build',
		'variant',
	].map((field): FieldNode => ['Field', field]);

	const [hasPrerelease, hasBuild, hasVariant]: BooleanTypeNodes[] = [
		prereleaseField,
		buildField,
		variantField,
	].map((field) => ['NotEquals', field, ['EmbeddedText', '']]);
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
		computed: {
			parallel: 'SAFE',
			volatility: 'IMMUTABLE',
			definition: semverField,
		},
	});

	const createdAtTimestampNode: CastNode = [
		'Cast',
		[
			'Floor',
			['Multiply', ['Totalseconds', ['Field', 'created at']], ['Number', 1000]],
		],
		'Text',
	];

	const versionCoreAndPrerelease = oneLineTrimSqlConcat`${versionCore}${joinTextPartsAndPrefix(
		'-',
		'.',
		[hasPrerelease, prereleaseField],
		[isDraft, createdAtTimestampNode],
	)}`;

	const hasPositiveRevisionNotInBuild: BooleanTypeNodes = [
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

	const rawVersionField = oneLineTrimSqlConcat`${versionCoreAndPrerelease}${[
		'Cast',
		[
			'Case',
			[
				'When',
				[
					'Or',
					hasBuild,
					['GreaterThan', revisionField, ['Number', 0]],
					hasVariant,
				],
				['EmbeddedText', '+'],
			],
			['Else', ['EmbeddedText', '']],
		],
		'Text',
	]}${joinTextParts(
		'.',
		[hasBuild, buildField],
		[hasPositiveRevisionNotInBuild, revN],
		[hasVariant, variantField],
	)}`;

	abstractSql.tables['release'].fields.push(
		{
			fieldName: 'raw version',
			dataType: 'Short Text',
			required: true,
			computed: {
				parallel: 'SAFE',
				volatility: 'IMMUTABLE',
				definition: rawVersionField,
			},
		},
		{
			fieldName: 'version',
			dataType: 'JSON',
			required: true,
			computed: {
				parallel: 'SAFE',
				volatility: 'IMMUTABLE',
				definition: [
					'Cast',
					oneLineTrimSqlConcat`{
			"raw": "${rawVersionField}",
			"major": ${majorField},
			"minor": ${minorField},
			"patch": ${patchField},
			"prerelease": [${joinTextParts(
				',',
				[hasPrerelease, splitStringParts(prereleaseField)],
				[isDraft, createdAtTimestampNode],
			)}],
			"build": [${joinTextParts(
				',',
				[hasBuild, splitStringParts(buildField)],
				[hasPositiveRevisionNotInBuild, oneLineTrimSqlConcat`"${revN}"`],
				[hasVariant, oneLineTrimSqlConcat`"${variantField}"`],
			)}],
			"version": "${versionCoreAndPrerelease}"
		}`,
					'JSON',
				],
			},
		},
	);
};

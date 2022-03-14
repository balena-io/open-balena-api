import { readFileSync } from 'fs';
import * as _ from 'lodash';

import type {
	AbstractSqlModel,
	ConcatenateNode,
	Definition,
	Relationship,
	RelationshipInternalNode,
	TextTypeNodes,
	BooleanTypeNodes,
	UnknownTypeNodes,
} from '@balena/abstract-sql-compiler';

import { sbvrUtils } from '@balena/pinejs';
import * as AbstractSqlCompiler from '@balena/abstract-sql-compiler';

export const { optimizeSchema } = AbstractSqlCompiler.postgres;

export const generateAbstractSqlModel = (
	seModelPath: string,
): AbstractSqlModel => {
	const seModel = readFileSync(seModelPath, 'utf8');
	const lfModel = sbvrUtils.generateLfModel(seModel);
	return sbvrUtils.generateAbstractSqlModel(lfModel);
};

export const aliasTable = (
	abstractSqlModel: AbstractSqlModel,
	resourceName: string,
	toResourceName: string,
	definition?: Definition,
) => {
	abstractSqlModel.tables[toResourceName] = _.cloneDeep(
		abstractSqlModel.tables[resourceName],
	);
	if (definition) {
		abstractSqlModel.tables[toResourceName].definition = definition;
	}
	abstractSqlModel.tables[toResourceName].name = toResourceName;
	abstractSqlModel.tables[toResourceName].resourceName = toResourceName;

	abstractSqlModel.relationships[toResourceName] = _.cloneDeep(
		abstractSqlModel.relationships[resourceName],
	);
};

const $aliasRelationships = (
	relationships: Relationship,
	resourceRegex: RegExp,
	toResourceName: string,
	inAliasingScope = false,
) => {
	if (Array.isArray(relationships.$) && relationships.$.length === 2) {
		const mapping = relationships.$;
		if (resourceRegex.test(mapping[1]![0])) {
			mapping[1]![0] = mapping[1]![0].replace(
				resourceRegex,
				`$1${toResourceName}$3`,
			);
			if (resourceRegex.test(mapping[0])) {
				mapping[0] = mapping[0].replace(resourceRegex, `$1${toResourceName}$3`);
			}

			relationships.$ = mapping;
		}
		if (inAliasingScope && resourceRegex.test(mapping[1]![1])) {
			mapping[1]![1] = mapping[1]![1].replace(
				resourceRegex,
				`$1${toResourceName}$3`,
			);
		}
	}
	_.forEach(relationships, (relationshipOrMapping, key) => {
		if (key === '$') {
			return;
		}
		let relationship = relationshipOrMapping as Relationship;
		const parentRelationships = relationships as RelationshipInternalNode;

		let startedAliasing = false;
		if (resourceRegex.test(key)) {
			relationship = _.cloneDeep(relationship);
			const aliasedKey = key.replace(resourceRegex, `$1${toResourceName}$3`);

			parentRelationships[aliasedKey] = relationship;
			// When have previously aliased the root of the current relation subtree,
			// remove unneeded references to the original resource, to completely replace it.
			if (inAliasingScope) {
				delete parentRelationships[key];
			}
			startedAliasing = true;
		}

		$aliasRelationships(
			relationship,
			resourceRegex,
			toResourceName,
			inAliasingScope || startedAliasing,
		);
	});
};

export const aliasRelationships = (
	relationships: Relationship,
	resourceName: string,
	toResourceName: string,
) =>
	$aliasRelationships(
		relationships,
		new RegExp(`(^|-)(${resourceName})(-|$)`, 'g'),
		toResourceName,
	);

export const renameField = (
	abstractSqlModel: AbstractSqlModel,
	resourceName: string,
	path: string[],
	from: string,
	to: string,
) => {
	abstractSqlModel.tables[resourceName].fields.forEach((field) => {
		if (field.fieldName === from) {
			field.fieldName = to;
		}
	});
	abstractSqlModel.tables[resourceName].indexes.forEach((index) => {
		index.fields = index.fields.map((field) => {
			if (field === from) {
				return to;
			}
			return field;
		});
	});

	const relationship = abstractSqlModel.relationships[resourceName];

	const orig = _.get(relationship, path);
	orig[to] = orig[from];
	delete orig[from];

	_.set(relationship, to, relationship[from]);
	delete relationship[from];
	_.set(relationship, [to, '$'], [to]);
};

const $renameEnvVarName = (abstractSql: AbstractSqlModel, resource: string) => {
	renameField(
		abstractSql,
		`${resource}-has-env var name`,
		[...resource.split('-'), 'has'],
		'env var name',
		'name',
	);
	renameField(
		abstractSql,
		`${resource}-has-env var name`,
		['has'],
		'env var name',
		'name',
	);
};
export const renameEnvVarName = (abstractSql: AbstractSqlModel) => {
	$renameEnvVarName(abstractSql, 'device');
	$renameEnvVarName(abstractSql, 'application');
};

const sqlConcatFactory = (
	...transformers: Array<
		(node: TextTypeNodes | string) => TextTypeNodes | string
	>
) => {
	return function sqlConcat(
		[start, ...strings]: TemplateStringsArray,
		...nodes: Array<TextTypeNodes | string>
	) {
		const concats: ConcatenateNode = ['Concatenate'];
		const addNode = (node: typeof nodes[number]) => {
			node = transformers.reduce((acc, transformer) => transformer(acc), node);
			if (typeof node === 'string') {
				if (node.length > 0) {
					concats.push(['EmbeddedText', node]);
				}
			} else {
				concats.push(node);
			}
		};
		addNode(start);
		for (let i = 0; i < strings.length; i++) {
			addNode(nodes[i]);
			addNode(strings[i]);
		}

		return concats;
	};
};

// ~Similar to oneLineTrim from common-tags
export const oneLineTrimSqlConcat = sqlConcatFactory((node) =>
	typeof node === 'string' ? node.replace(/\s*\n\s*/g, '') : node,
);

export const splitStringParts = (field: UnknownTypeNodes, separator = '.') =>
	oneLineTrimSqlConcat`"${[
		'Replace',
		field,
		['EmbeddedText', separator],
		['EmbeddedText', '","'],
	]}"`;

export const joinTextParts = (
	prefix: string,
	[showPartA, partAValue]: [BooleanTypeNodes, UnknownTypeNodes],
	separator: string,
	[showPartB, partBValue]: [BooleanTypeNodes, UnknownTypeNodes],
): ReturnType<typeof oneLineTrimSqlConcat> =>
	oneLineTrimSqlConcat`${[
		'Cast',
		[
			'Case',
			['When', showPartA, oneLineTrimSqlConcat`${prefix}${partAValue}`],
			['Else', ['EmbeddedText', '']],
		],
		'Text',
	]}${[
		'Cast',
		[
			'Case',
			[
				'When',
				showPartB,
				oneLineTrimSqlConcat`${[
					'Cast',
					[
						'Case',
						['When', showPartA, ['EmbeddedText', separator]],
						['Else', ['EmbeddedText', prefix]],
					],
					'Text',
				]}${partBValue}`,
			],
			['Else', ['EmbeddedText', '']],
		],
		'Text',
	]}`;

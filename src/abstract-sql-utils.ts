import { readFileSync } from 'fs';
import _ from 'lodash';

import type {
	AbstractSqlModel,
	CastNode,
	ConcatenateNode,
	ConcatenateWithSeparatorNode,
	Definition,
	TextTypeNodes,
	BooleanTypeNodes,
	ReferencedFieldNode,
	SelectQueryNode,
	NumberTypeNodes,
	UnknownTypeNodes,
	NullNode,
	SelectNode,
	AliasNode,
} from '@balena/abstract-sql-compiler';

import { sbvrUtils } from '@balena/pinejs';
import * as AbstractSqlCompiler from '@balena/abstract-sql-compiler';

export const { optimizeSchema } = AbstractSqlCompiler.postgres;

export const generateAbstractSqlModel = (
	seModelPath: string | URL,
): AbstractSqlModel =>
	generateAbstractSqlModelFromSE(readFileSync(seModelPath, 'utf8'));

export const generateAbstractSqlModelFromSE = (
	seModel: string,
): AbstractSqlModel => {
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

export const renameField = (
	abstractSqlModel: AbstractSqlModel,
	resourceName: string,
	path: string[],
	from: string,
	to: string,
) => {
	for (const field of abstractSqlModel.tables[resourceName].fields) {
		if (field.fieldName === from) {
			field.fieldName = to;
		}
	}
	for (const index of abstractSqlModel.tables[resourceName].indexes) {
		index.fields = index.fields.map((field) => {
			if (field === from) {
				return to;
			}
			return field;
		});
	}

	const relationship = abstractSqlModel.relationships[resourceName];

	const orig = _.get(relationship, path);
	orig[to] = orig[from];
	delete orig[from];

	_.set(relationship, to, relationship[from]);
	delete relationship[from];
	_.set(relationship, [to, '$'], [to]);
};

export const renameResourceField = (
	abstractSql: AbstractSqlModel,
	resource: string,
	fromFieldName: string,
	toFieldName: string,
) => {
	renameField(
		abstractSql,
		`${resource}-has-${fromFieldName}`,
		[...resource.split('-'), 'has'],
		fromFieldName,
		toFieldName,
	);
	renameField(
		abstractSql,
		`${resource}-has-${fromFieldName}`,
		['has'],
		fromFieldName,
		toFieldName,
	);
};

export const renameVarResourcesName = (abstractSql: AbstractSqlModel) => {
	for (const resource of ['device', 'application']) {
		renameResourceField(abstractSql, resource, 'config var name', 'name');
		renameResourceField(abstractSql, resource, 'env var name', 'name');
	}
};

const sqlConcatFactory = (
	...transformers: Array<
		(node: TextTypeNodes | string) => TextTypeNodes | string
	>
) => {
	return function sqlConcat(
		[start, ...strings]: TemplateStringsArray,
		...nodes: Array<TextTypeNodes | string>
	): ConcatenateNode {
		const concats: TextTypeNodes[] = [];
		const addNode = (node: (typeof nodes)[number]) => {
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

		return ['Concatenate', ...(concats as [TextTypeNodes, ...TextTypeNodes[]])];
	};
};

// ~Similar to oneLineTrim from common-tags
export const oneLineTrimSqlConcat = sqlConcatFactory((node) =>
	typeof node === 'string' ? node.replace(/\s*\n\s*/g, '') : node,
);

export const splitStringParts = (field: TextTypeNodes, separator = '.') =>
	oneLineTrimSqlConcat`"${[
		'Replace',
		field,
		['EmbeddedText', separator],
		['EmbeddedText', '","'],
	]}"`;

export const joinTextParts = (
	separator: string,
	...parts: Array<[showPart: BooleanTypeNodes, partValue: TextTypeNodes]>
): ConcatenateWithSeparatorNode => {
	if (parts.length < 2) {
		throw new Error('joinTextParts requires at least two parts to join');
	}
	return [
		'ConcatenateWithSeparator',
		['EmbeddedText', separator],
		...(parts.map(
			([showPart, partValue]): CastNode => [
				'Cast',
				['Case', ['When', showPart, partValue]],
				'Text',
			],
		) as [CastNode, ...CastNode[]]),
	];
};

export const joinTextPartsAndPrefix = (
	prefix: string,
	separator: string,
	...parts: Array<[showPart: BooleanTypeNodes, partValue: TextTypeNodes]>
): ConcatenateNode | ConcatenateWithSeparatorNode => {
	const joinedParts = joinTextParts(separator, ...parts);
	if (prefix === '') {
		return joinedParts;
	}

	return [
		'Concatenate',
		[
			'Cast',
			[
				'Case',
				[
					'When',
					['Or', ...parts.map(([showPart]) => showPart)],
					['EmbeddedText', prefix],
				],
				['Else', ['EmbeddedText', '']],
			],
			'Text',
		],
		joinedParts,
	];
};

export const overrideFieldType = (
	abstractSqlModel: AbstractSqlModel,
	resourceName: string,
	fieldName: string,
	newFieldType: string,
) => {
	if (abstractSqlModel.tables[resourceName] == null) {
		throw new Error(
			`Could not find resource "${resourceName}" while trying to override field type for "${fieldName}"`,
		);
	}
	const targetField = abstractSqlModel.tables[resourceName].fields.find(
		(field) => field.fieldName === fieldName,
	);
	if (targetField == null) {
		throw new Error(
			`Could not find field "${fieldName}" on resource "${resourceName}" while trying to change its type to "${newFieldType}"`,
		);
	}
	if (targetField.dataType === newFieldType) {
		throw new Error(
			`Field "${fieldName}" on resource "${resourceName}" is already of type "${newFieldType}"`,
		);
	}
	targetField.dataType = newFieldType;
};

export type AliasValidNodeType =
	| ReferencedFieldNode
	| SelectQueryNode
	| NumberTypeNodes
	| BooleanTypeNodes
	| UnknownTypeNodes
	| NullNode;

export const aliasFields = (
	abstractSqlModel: AbstractSqlModel,
	resourceName: string,
	aliases: Dictionary<string | AliasValidNodeType>,
): SelectNode[1] => {
	const fieldNames = abstractSqlModel.tables[resourceName].fields.map(
		({ fieldName }) => fieldName,
	);
	const nonexistentFields = _.difference(Object.keys(aliases), fieldNames, [
		'$toResource',
	]);
	if (nonexistentFields.length > 0) {
		throw new Error(
			`Tried to alias non-existent fields: '${nonexistentFields.join(', ')}'`,
		);
	}
	return fieldNames.map(
		(fieldName): AliasNode<AliasValidNodeType> | ReferencedFieldNode => {
			const alias = aliases[fieldName];
			if (alias) {
				if (typeof alias === 'string') {
					return ['Alias', ['ReferencedField', resourceName, alias], fieldName];
				}
				return ['Alias', alias, fieldName];
			}
			return ['ReferencedField', resourceName, fieldName];
		},
	);
};

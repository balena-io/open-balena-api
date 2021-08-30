import { readFileSync } from 'fs';
import * as _ from 'lodash';

import type {
	AbstractSqlModel,
	ConcatenateNode,
	Definition,
	TextTypeNodes,
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

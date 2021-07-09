import type { AbstractSqlModel } from '@balena/abstract-sql-compiler';

export const addToModel = (abstractSql: AbstractSqlModel) => {
	abstractSql.tables['release'].fields.push({
		fieldName: 'is final',
		dataType: 'Boolean',
		required: true,
		// TODO[release versioning next step]: Change to:
		// computed: ['Exists', ['ReferencedField', 'release', 'revision']],
		computed: [
			'Equals',
			['ReferencedField', 'release', 'release type'],
			['EmbeddedText', 'final'],
		],
	});
};

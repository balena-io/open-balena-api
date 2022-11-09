import type {
	AbstractSqlModel,
	SelectQueryNode,
} from '@balena/abstract-sql-compiler';
import _ from 'lodash';

export const addToModel = (
	abstractSql: AbstractSqlModel,
	selectQueryNodeTransformer: (
		selectQueryNode: SelectQueryNode,
	) => SelectQueryNode = _.identity,
) => {
	abstractSql.tables['user-has direct access to-application'] = {
		fields: [
			{
				dataType: 'Big Integer',
				fieldName: 'id',
				required: true,
				index: 'PRIMARY KEY',
			},
			{
				dataType: 'ForeignKey',
				fieldName: 'user',
				required: true,
				references: {
					resourceName: 'user',
					fieldName: 'id',
				},
			},
			{
				dataType: 'ForeignKey',
				fieldName: 'has direct access to-application',
				required: true,
				references: {
					resourceName: 'application',
					fieldName: 'id',
				},
			},
		],
		primitive: false,
		name: 'user-has direct access to-application',
		indexes: [],
		idField: 'id',
		resourceName: 'user-has direct access to-application',
	};

	abstractSql.relationships['user-has direct access to-application'] = {
		user: {
			$: ['user', ['user', 'id']],
		},
		application: {
			$: ['has direct access to-application', ['application', 'id']],
		},
		'has direct access to': {
			application: {
				$: ['has direct access to-application', ['application', 'id']],
			},
		},
		'is directly accessible by': {
			user: {
				$: ['user', ['user', 'id']],
			},
		},
	};

	abstractSql.relationships['user'] = _.merge(
		abstractSql.relationships['user'],
		{
			'has direct access to': {
				application: {
					$: ['id', ['user-has direct access to-application', 'user']],
				},
			},
		},
	);

	abstractSql.relationships['application'] = _.merge(
		abstractSql.relationships['application'],
		{
			'is directly accessible by': {
				user: {
					$: [
						'id',
						[
							'user-has direct access to-application',
							'has direct access to-application',
						],
					],
				},
			},
		},
	);

	abstractSql.tables['user-has direct access to-application'].definition = {
		abstractSql: selectQueryNodeTransformer([
			'SelectQuery',
			[
				'Select',
				[
					['Alias', ['Null'], 'id'],
					['Alias', ['ReferencedField', 'application.user', 'id'], 'user'],
					[
						'Alias',
						['ReferencedField', 'application', 'id'],
						'has direct access to-application',
					],
				],
			],
			['From', ['Alias', ['Resource', 'application'], 'application']],
			['CrossJoin', ['Alias', ['Resource', 'user'], 'application.user']],
			[
				'Where',
				[
					'Equals',
					['ReferencedField', 'application.user', 'actor'],
					['Bind', '@__ACTOR_ID'],
				],
			],
		]),
	};
};

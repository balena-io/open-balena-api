import {
	aliasTable,
	generateAbstractSqlModel,
	renameEnvVarName,
} from './abstract-sql-utils';

import * as deviceAdditions from './features/devices/models/device-additions';

export const apiRoot = 'resin';
export const modelName = 'balena';
export const migrationsPath = __dirname + '/migrations/';
export const initSqlPath = __dirname + '/balena-init.sql';
export const abstractSql = generateAbstractSqlModel(__dirname + '/balena.sbvr');

aliasTable(abstractSql, 'application', 'my application', {
	binds: [],
	abstractSql: ['Resource', 'application'],
});

renameEnvVarName(abstractSql);

deviceAdditions.addToModel(abstractSql);

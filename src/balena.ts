import {
	aliasTable,
	generateAbstractSqlModel,
	renameEnvVarName,
	optimizeSchema,
} from './abstract-sql-utils';

import * as userHasDirectAccessToApplication from './features/applications/models/user__has_direct_access_to__application';
import * as deviceAdditions from './features/devices/models/device-additions';
import * as releaseAdditions from './features/ci-cd/models/release-additions';

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

userHasDirectAccessToApplication.addToModel(abstractSql);
deviceAdditions.addToModel(abstractSql);
releaseAdditions.addToModel(abstractSql);

optimizeSchema(abstractSql);

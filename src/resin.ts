import * as _ from 'lodash';
import { generateAbstractSqlModel, aliasTable } from './abstract-sql-utils';

export const apiRoot = 'resin';
export const modelName = 'resin';
export const migrationsPath = __dirname + '/migrations/';
export const initSqlPath = __dirname + '/resin-init.sql';
export const abstractSql = generateAbstractSqlModel(__dirname + '/resin.sbvr');

aliasTable(abstractSql, 'application', 'my application', {
	extraBinds: [],
	abstractSqlQuery: ['Resource', 'application'],
});

import type { ConfigLoader } from '@balena/pinejs';
import {
	generateAbstractSqlModel,
	overrideFieldType,
	renameVarResourcesName,
} from '../../abstract-sql-utils.js';
import * as userHasDirectAccessToApplication from '../../features/applications/models/user__has_direct_access_to__application.js';

export const toVersion = 'resin';

export const v7AbstractSqlModel = generateAbstractSqlModel(
	new URL('v7.sbvr', import.meta.url),
);

renameVarResourcesName(v7AbstractSqlModel);

overrideFieldType(v7AbstractSqlModel, 'release', 'version', 'JSON');

userHasDirectAccessToApplication.addToModel(v7AbstractSqlModel);
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- So that the interface is already well defined.
export const getV7Translations = (_abstractSqlModel = v7AbstractSqlModel) => {
	return {} satisfies ConfigLoader.Model['translations'];
};

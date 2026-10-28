import { fileURLToPath } from 'node:url';
import {
	generateAbstractSqlModel,
	renameVarResourcesName,
	optimizeSchema,
} from './abstract-sql-utils.ts';

import * as userHasDirectAccessToApplication from './features/applications/models/user__has_direct_access_to__application.ts';
import * as deviceAdditions from './features/devices/models/device-additions.ts';
import * as releaseAdditions from './features/ci-cd/models/release-additions.ts';
import * as applicationProfileCatalogAdditions from './features/profiles/models/application-profile-catalog-additions.ts';
import type { ConfigLoader } from '@balena/pinejs';

const abstractSql = generateAbstractSqlModel(
	new URL('balena.sbvr', import.meta.url),
);

export const model = {
	apiRoot: 'resin',
	modelName: 'balena',
	migrationsPath: fileURLToPath(new URL('migrations/', import.meta.url)),
	initSqlPath: fileURLToPath(new URL('balena-init.sql', import.meta.url)),
	abstractSql,
} satisfies ConfigLoader.Model;

renameVarResourcesName(abstractSql);

userHasDirectAccessToApplication.addToModel(abstractSql);
deviceAdditions.addToModel(abstractSql);
releaseAdditions.addToModel(abstractSql);
applicationProfileCatalogAdditions.addToModel(abstractSql);

optimizeSchema(abstractSql);

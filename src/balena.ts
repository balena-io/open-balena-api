import { fileURLToPath } from 'node:url';
import {
	generateAbstractSqlModel,
	renameVarResourcesName,
	optimizeSchema,
} from './abstract-sql-utils.js';

import * as userHasDirectAccessToApplication from './features/applications/models/user__has_direct_access_to__application.js';
import * as deviceAdditions from './features/devices/models/device-additions.js';
import * as releaseAdditions from './features/ci-cd/models/release-additions.js';
import * as profileAdditions from './features/profiles/models/profile-additions.js';
import * as rulesReplacementHack from './balena-rules-replacement-hack.js';
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
profileAdditions.addToModel(abstractSql);

optimizeSchema(abstractSql);

rulesReplacementHack.apply(abstractSql);

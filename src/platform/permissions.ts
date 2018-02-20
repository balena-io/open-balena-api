import * as _ from 'lodash';
import * as Promise from 'bluebird';
import * as randomstring from 'randomstring';

import { Tx, authApi, getOrInsertId, root } from './index';
import { findUser } from './auth';
import { captureException } from './errors';

// role and permission helpers

export const getOrInsertRoleId = (name: string, tx: Tx) =>
	getOrInsertId('role', { name }, tx);

export const getOrInsertPermissionId = (name: string, tx: Tx) =>
	getOrInsertId('permission', { name }, tx);

export const assignRolePermission = (
	role: number,
	permission: number,
	tx: Tx,
) => getOrInsertId('role__has__permission', { role, permission }, tx);

const assignRolePermissions = (roleId: number, permissions: string[], tx: Tx) =>
	Promise.map(permissions, name =>
		getOrInsertPermissionId(name, tx).then(permission =>
			assignRolePermission(roleId, permission.id, tx),
		),
	);

export const assignUserRole = (user: number, role: number, tx: Tx) =>
	getOrInsertId('user__has__role', { user, role }, tx);

export const assignUserPermission = (
	user: number,
	permission: number,
	tx?: Tx,
) => getOrInsertId('user__has__permission', { user, permission }, tx);

// api key helpers

export const getOrInsertApiKey = (
	actorId: number,
	role: { id: number },
	tx: Tx,
): Promise<AnyObject> => {
	const authApiTx = authApi.clone({
		passthrough: {
			tx,
			req: root,
		},
	});
	return authApiTx
		.get({
			resource: 'api_key',
			passthrough: { req: root },
			options: {
				$filter: {
					is_of__actor: actorId,
					has__role: {
						$any: {
							$alias: 'khr',
							$expr: {
								khr: { role: role.id },
							},
						},
					},
				},
			},
		})
		.then((apiKeys: AnyObject[]) => {
			const len = apiKeys.length;

			if (len === 0) {
				const key = randomstring.generate();
				const body = {
					is_of__actor: actorId,
					key,
				};

				return authApiTx
					.post({
						resource: 'api_key',
						passthrough: { req: root },
						body,
					})
					.then((idObj: AnyObject) => _.assign({}, idObj, body))
					.tap(apiKey =>
						authApiTx.post({
							resource: 'api_key__has__role',
							passthrough: { req: root },
							body: {
								api_key: apiKey.id,
								role: role.id,
							},
							options: { returnResource: false },
						}),
					);
			} else {
				if (len > 1) {
					console.warn(
						`Actor ID ${actorId} has ${len} API keys for role ${role.id}`,
					);
				}
				return apiKeys[0];
			}
		});
};

export const setApiKey = (
	role: string,
	permissions: string[],
	key: string,
	tx: Tx,
): Promise<AnyObject> =>
	getOrInsertRoleId(role, tx)
		.tap(role => assignRolePermissions(role.id, permissions, tx))
		.then(role =>
			findUser('guest', tx).then(user => {
				if (user == null || user.actor == null) {
					throw new Error('Cannot find guest user');
				}
				return getOrInsertApiKey(user.actor, role, tx);
			}),
		)
		.then(apiKey => {
			if (key) {
				return (
					authApi
						.patch({
							resource: 'api_key',
							id: apiKey.id,
							passthrough: {
								req: root,
								tx,
							},
							body: {
								key,
							},
						})
						// authApi.patch doesn't resolve to the result, have to manually return here
						.return(_.merge(apiKey, { key }))
				);
			} else {
				return apiKey;
			}
		});

export type PermissionSet = string[];

export type RolePermissionsMap = {
	[roleName: string]: PermissionSet;
};

export type ApiKeyPermissionsMap = {
	[keyName: string]: {
		key?: string;
		permissions: PermissionSet;
	};
};

export type EmailSet = string[];

export type UserRoleMap = {
	[roleName: string]: EmailSet;
};

export function createAll(
	tx: Tx,
	permissionNames: PermissionSet,
	roleMap: RolePermissionsMap,
	apiKeyMap: ApiKeyPermissionsMap,
	userMap: UserRoleMap,
) {
	const apiTx = authApi.clone({ passthrough: { req: root, tx } });

	const permissionsCache = apiTx
		.get({
			resource: 'permission',
			options: {
				$select: ['id', 'name'],
				$filter: { name: { $in: permissionNames } },
			},
		})
		.then((permissions: AnyObject[]) => {
			const permissionsMap = _(permissions)
				.keyBy('name')
				.mapValues('id')
				.value();
			const result: Dictionary<number | Promise<number>> = {};
			for (const permissionName of permissionNames) {
				if (permissionsMap[permissionName] != null) {
					result[permissionName] = permissionsMap[permissionName];
				} else {
					result[permissionName] = apiTx
						.post({
							resource: 'permission',
							body: { name: permissionName },
							options: { returnResource: false },
						})
						.then(({ id }: AnyObject) => id);
				}
			}
			return Promise.props<Dictionary<number>>(result);
		});

	const createRolePermissions = (permissionNames: string[], roleName: string) =>
		getOrInsertRoleId(roleName, tx)
			.tap(role => {
				if (permissionNames.length === 0) {
					return;
				}
				return permissionsCache.then(permissionsCache => {
					const permissions = _.values(
						_.pick(permissionsCache, permissionNames),
					);
					const addPermissionsPromise = apiTx
						.get({
							resource: 'role__has__permission',
							options: {
								$select: 'permission',
								$filter: {
									role: role.id,
									permission: { $in: permissions },
								},
							},
						})
						.then((rolePermissions: AnyObject[]) => {
							const rolePermissionIds: number[] = _.map(
								rolePermissions,
								({ permission }) => permission.__id,
							);
							return _.difference(permissions, rolePermissionIds);
						})
						.map(permission =>
							apiTx.post({
								resource: 'role__has__permission',
								body: {
									role: role.id,
									permission: permission,
								},
								options: { returnResource: false },
							}),
						);
					const deletePermissionsPromise = apiTx.delete({
						resource: 'role__has__permission',
						options: {
							$filter: {
								role: role.id,
								$not: { permission: { $in: permissions } },
							},
						},
					});
					return Promise.all([addPermissionsPromise, deletePermissionsPromise]);
				});
			})
			.tapCatch(err => {
				captureException(err, `Error on configuring ${roleName}`);
			});

	const rolesPromise = Promise.props<Dictionary<{ id: number }>>(
		_.mapValues(roleMap, createRolePermissions),
	)
		.tap(roles =>
			// Assign user roles
			Promise.all(
				_.map(userMap, (userEmails, roleName) =>
					Promise.mapSeries(userEmails, email =>
						findUser(email, tx)
							.then(user => {
								if (user == null || user.id == null) {
									throw new Error(`User ${email} not found.`);
								}
								return assignUserRole(user.id, roles[roleName].id, tx);
							})
							.catch(_.noop),
					),
				),
			),
		)
		.tap(() =>
			// Remove stale permissions, preserving unassigned ones.
			permissionsCache.then(permissions =>
				apiTx
					.delete({
						resource: 'permission',
						options: {
							$filter: {
								$not: {
									$or: [
										{
											is_of__role: {
												$any: {
													$alias: 'rhp',
													$expr: { rhp: { id: { $ne: null } } },
												},
											},
										},
										{
											is_of__user: {
												$any: {
													$alias: 'uhp',
													$expr: { uhp: { id: { $ne: null } } },
												},
											},
										},
										{
											is_of__api_key: {
												$any: {
													$alias: 'ahp',
													$expr: { ahp: { id: { $ne: null } } },
												},
											},
										},
										{ id: { $in: _.values(permissions) } },
									],
								},
							},
						},
					})
					.tapCatch(err => {
						captureException(err, 'Error on clearing stale permissions');
					}),
			),
		);

	const apiKeysPromise = Promise.map(
		_.toPairs(apiKeyMap),
		([role, { permissions, key }]) =>
			createRolePermissions(permissions, role)
				.then(role =>
					findUser('guest', tx).then(user => {
						if (user == null || user.actor == null) {
							throw new Error('Cannot find guest user');
						}
						return getOrInsertApiKey(user.actor, role, tx);
					}),
				)
				.then(apiKey => {
					if (!key) {
						return apiKey.key;
					}
					return (
						apiTx
							.patch({
								resource: 'api_key',
								id: apiKey.id,
								passthrough: {
									req: root,
									tx,
								},
								body: {
									key,
								},
							})
							// authApi.patch doesn't resolve to the result,
							// have to manually return here
							.return(key)
					);
				})
				.catch(err => {
					captureException(err, `Error creating ${role} API key!`);
				}),
	);

	return Promise.props({
		roles: rolesPromise,
		apiKeys: apiKeysPromise,
	});
}

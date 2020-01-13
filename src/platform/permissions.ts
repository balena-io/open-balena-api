import * as _ from 'lodash';
import * as Bluebird from 'bluebird';
import * as randomstring from 'randomstring';

import { Tx, getOrInsertId } from './index';
import { findUser } from './auth';
import { captureException } from './errors';
import { sbvrUtils } from '@resin/pinejs';

const { root, api } = sbvrUtils;

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
	Bluebird.map(permissions, async name => {
		const permission = await getOrInsertPermissionId(name, tx);
		await assignRolePermission(roleId, permission.id, tx);
	});

export const assignUserRole = (user: number, role: number, tx: Tx) =>
	getOrInsertId('user__has__role', { user, role }, tx);

export const assignUserPermission = (
	user: number,
	permission: number,
	tx?: Tx,
) => getOrInsertId('user__has__permission', { user, permission }, tx);

// api key helpers

const getOrInsertApiKey = async (
	actorId: number,
	role: { id: number },
	tx: Tx,
): Promise<AnyObject> => {
	const authApiTx = api.Auth.clone({
		passthrough: {
			tx,
			req: root,
		},
	});
	const apiKeys = (await authApiTx.get({
		resource: 'api_key',
		passthrough: { req: root },
		options: {
			$select: ['id', 'key'],
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
	})) as AnyObject[];
	const len = apiKeys.length;

	if (len === 0) {
		const key = randomstring.generate();
		const body = {
			is_of__actor: actorId,
			key,
		};

		const idObj = (await authApiTx.post({
			resource: 'api_key',
			passthrough: { req: root },
			body,
		})) as { id: number };
		const apiKey = { ...idObj, ...body };
		await authApiTx.post({
			resource: 'api_key__has__role',
			passthrough: { req: root },
			body: {
				api_key: apiKey.id,
				role: role.id,
			},
			options: { returnResource: false },
		});
		return apiKey;
	} else {
		if (len > 1) {
			console.warn(
				`Actor ID ${actorId} has ${len} API keys for role ${role.id}`,
			);
		}
		return apiKeys[0];
	}
};

export const setApiKey = async (
	roleName: string,
	permissions: string[],
	key: string,
	tx: Tx,
): Promise<AnyObject> => {
	const role = await getOrInsertRoleId(roleName, tx);
	await assignRolePermissions(role.id, permissions, tx);
	const user = await findUser('guest', tx);
	if (user == null || user.actor == null) {
		throw new Error('Cannot find guest user');
	}
	const apiKey = await getOrInsertApiKey(user.actor, role, tx);

	if (key) {
		apiKey.key = key;
		await api.Auth.patch({
			resource: 'api_key',
			id: apiKey.id,
			passthrough: {
				req: root,
				tx,
			},
			body: {
				key,
			},
		});
	}
	return apiKey;
};

export type PermissionSet = string[];

export interface RolePermissionsMap {
	[roleName: string]: PermissionSet;
}

export interface ApiKeyPermissionsMap {
	[keyName: string]: {
		key?: string;
		permissions: PermissionSet;
	};
}

export type EmailSet = string[];

export interface UserRoleMap {
	[roleName: string]: EmailSet;
}

export function createAll(
	tx: Tx,
	permissionNames: PermissionSet,
	roleMap: RolePermissionsMap,
	apiKeyMap: ApiKeyPermissionsMap,
	userMap: UserRoleMap,
) {
	const apiTx = api.Auth.clone({ passthrough: { req: root, tx } });

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
			return Bluebird.props<Dictionary<number>>(result);
		});

	const createRolePermissions = async (
		permissionNames: string[],
		roleName: string,
	): Promise<{ id: number }> => {
		try {
			const role = await getOrInsertRoleId(roleName, tx);
			if (permissionNames.length === 0) {
				return role;
			}
			const permissions = Object.values(
				_.pick(await permissionsCache, permissionNames),
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
					const rolePermissionIds: number[] = rolePermissions.map(
						({ permission }) => permission.__id,
					);
					return _.difference(permissions, rolePermissionIds);
				})
				.map(permission =>
					apiTx.post({
						resource: 'role__has__permission',
						body: {
							role: role.id,
							permission,
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
			await Promise.all([addPermissionsPromise, deletePermissionsPromise]);
			return role;
		} catch (err) {
			captureException(err, `Error on configuring ${roleName}`);
			throw err;
		}
	};

	const rolesPromise = Bluebird.props<Dictionary<{ id: number }>>(
		_.mapValues(roleMap, createRolePermissions),
	).tap(async roles => {
		// Assign user roles
		await Bluebird.all(
			_.map(userMap, async (userEmails, roleName) => {
				for (const email of userEmails) {
					try {
						const user = await findUser(email, tx);
						if (user == null || user.id == null) {
							throw new Error(`User ${email} not found.`);
						}
						await assignUserRole(user.id, roles[roleName].id, tx);
					} catch {}
				}
			}),
		);
		// Remove stale permissions, preserving unassigned ones.
		const permissions = await permissionsCache;
		try {
			await apiTx.delete({
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
								{ id: { $in: Object.values(permissions) } },
							],
						},
					},
				},
			});
		} catch (err) {
			captureException(err, 'Error on clearing stale permissions');
			throw err;
		}
	});

	const apiKeysPromise = Bluebird.map(
		_.toPairs(apiKeyMap),
		async ([roleName, { permissions, key }]) => {
			try {
				const role = await createRolePermissions(permissions, roleName);
				const user = await findUser('guest', tx);
				if (user == null || user.actor == null) {
					throw new Error('Cannot find guest user');
				}
				const apiKey = await getOrInsertApiKey(user.actor, role, tx);

				if (!key) {
					return apiKey.key;
				}
				await apiTx.patch({
					resource: 'api_key',
					id: apiKey.id,
					passthrough: {
						req: root,
						tx,
					},
					body: {
						key,
					},
				});
				// authApi.patch doesn't resolve to the result,
				// have to manually return here
				return key;
			} catch (err) {
				captureException(err, `Error creating ${roleName} API key!`);
			}
		},
	);

	return Bluebird.props({
		roles: rolesPromise,
		apiKeys: apiKeysPromise,
	});
}

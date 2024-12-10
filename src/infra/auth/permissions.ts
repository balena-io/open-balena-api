import Bluebird from 'bluebird';
import _ from 'lodash';
import randomstring from 'randomstring';
import memoize from 'memoizee';

import { sbvrUtils, permissions } from '@balena/pinejs';

import { findUser } from './auth.js';
import { captureException } from '../error-handling/index.js';
import { getOrInsertId } from '../pinejs-client-helpers/index.js';

const { api } = sbvrUtils;

export const getGuestActorId = memoize(
	async (): Promise<number> => {
		const guest = await sbvrUtils.db.readTransaction(
			async (tx) => await findUser('guest', tx, ['actor']),
		);
		if (guest?.actor == null) {
			throw new Error('Cannot find guest user');
		}
		return guest.actor.__id;
	},
	{
		promise: true,
		primitive: true,
	},
);

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

const assignRolePermissions = (
	roleId: number,
	rolePermissions: string[],
	tx: Tx,
) =>
	Promise.all(
		rolePermissions.map(async (name) => {
			const permission = await getOrInsertPermissionId(name, tx);
			await assignRolePermission(roleId, permission.id, tx);
		}),
	);

export const assignUserRole = (user: number, role: number, tx: Tx) =>
	getOrInsertId('user__has__role', { user, role }, tx);

export const assignUserPermission = (
	user: number,
	permission: number,
	tx: Tx,
) => getOrInsertId('user__has__permission', { user, permission }, tx);

export const revokeUserRole = async (user: number, role: number, tx: Tx) => {
	await api.Auth.delete({
		resource: 'user__has__role',
		id: {
			user,
			role,
		},
		passthrough: {
			tx,
			req: permissions.root,
		},
	});
};

// api key helpers

const getOrInsertApiKey = async (
	actorId: number,
	role: { id: number },
	tx: Tx,
) => {
	const authApiTx = api.Auth.clone({
		passthrough: {
			tx,
			req: permissions.root,
		},
	});
	const apiKeys = await authApiTx.get({
		resource: 'api_key',
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
	});
	const len = apiKeys.length;

	if (len === 0) {
		const key = randomstring.generate();
		const body = {
			is_of__actor: actorId,
			key,
		};

		const idObj = await authApiTx.post({
			resource: 'api_key',
			body,
		});
		const apiKey = { ...idObj, ...body };
		await authApiTx.post({
			resource: 'api_key__has__role',
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
	apiKeyPermissions: string[],
	key: string,
	tx: Tx,
) => {
	const role = await getOrInsertRoleId(roleName, tx);
	await assignRolePermissions(role.id, apiKeyPermissions, tx);
	const guestActorId = await getGuestActorId();
	const apiKey = await getOrInsertApiKey(guestActorId, role, tx);

	if (key) {
		apiKey.key = key;
		await api.Auth.patch({
			resource: 'api_key',
			id: apiKey.id,
			passthrough: {
				req: permissions.root,
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

export async function createAllPermissions(
	tx: Tx,
	permissionNames: PermissionSet,
	roleMap: RolePermissionsMap,
	apiKeyMap: ApiKeyPermissionsMap,
	userMap: UserRoleMap,
) {
	const apiTx = api.Auth.clone({ passthrough: { req: permissions.root, tx } });

	const permissionsCache = apiTx
		.get({
			resource: 'permission',
			options: {
				$select: ['id', 'name'],
				$filter: { name: { $in: permissionNames } },
			},
		})
		.then(async (perms) => {
			const permissionsMap = _(perms).keyBy('name').mapValues('id').value();
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
						.then(({ id }) => id);
				}
			}
			return await Bluebird.props<Dictionary<number>>(result);
		});

	const createRolePermissions = async (
		rolePermissionNames: string[],
		roleName: string,
	): Promise<{ id: number }> => {
		try {
			const role = await getOrInsertRoleId(roleName, tx);
			if (rolePermissionNames.length === 0) {
				return role;
			}
			const perms = Object.values(
				_.pick(await permissionsCache, rolePermissionNames),
			);
			const addPermissionsPromise = (async () => {
				const rolePermissions = await apiTx.get({
					resource: 'role__has__permission',
					options: {
						$select: 'permission',
						$filter: {
							role: role.id,
							permission: { $in: perms },
						},
					},
				});
				const rolePermissionIds: number[] = rolePermissions.map(
					({ permission }) => permission.__id,
				);
				await Promise.all(
					_.difference(perms, rolePermissionIds).map((permission) =>
						apiTx.post({
							resource: 'role__has__permission',
							body: {
								role: role.id,
								permission,
							},
							options: { returnResource: false },
						}),
					),
				);
			})();
			const deletePermissionsPromise = apiTx.delete({
				resource: 'role__has__permission',
				options: {
					$filter: {
						role: role.id,
						$not: { permission: { $in: perms } },
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
	).tap(async (resolvedRoleMap) => {
		// Assign user roles
		await Promise.all(
			_.map(userMap, async (userEmails, roleName) => {
				for (const email of userEmails) {
					try {
						const user = await findUser(email, tx, ['id']);
						if (user?.id == null) {
							throw new Error(`User ${email} not found.`);
						}
						await assignUserRole(user.id, resolvedRoleMap[roleName].id, tx);
					} catch {
						// Ignore errors
					}
				}
			}),
		);
		// Remove stale permissions, preserving unassigned ones.
		const perms = await permissionsCache;
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
								{ id: { $in: Object.values(perms) } },
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

	const apiKeysPromise = Promise.all(
		_.toPairs(apiKeyMap).map(
			async ([roleName, { permissions: apiKeyPermissions, key }]) => {
				try {
					const role = await createRolePermissions(apiKeyPermissions, roleName);
					const guestActorId = await getGuestActorId();
					const apiKey = await getOrInsertApiKey(guestActorId, role, tx);

					if (!key) {
						return apiKey.key;
					}
					await apiTx.patch({
						resource: 'api_key',
						id: apiKey.id,
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
		),
	);

	const [roles, apiKeys] = await Promise.all([rolesPromise, apiKeysPromise]);
	return { roles, apiKeys };
}

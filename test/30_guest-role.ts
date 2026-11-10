import { expect } from 'chai';
import { randomUUID } from 'node:crypto';
import _ from 'lodash';
import { permissions, sbvrUtils } from '@balena/pinejs';
import { KEYS, ROLES } from '../src/lib/auth.ts';
import {
	assignUserPermission,
	assignUserRole,
	createAllPermissions,
	getOrInsertPermissionId,
	getOrInsertRoleId,
} from '../src/infra/auth/permissions.ts';
import { assertExists } from './test-lib/common.ts';
import { supertest } from './test-lib/supertest.ts';

const { api } = sbvrUtils;

const authApi = api.Auth.clone({ passthrough: { req: permissions.root } });

const getPermissionId = async (name: string) =>
	(
		await authApi.get({
			resource: 'permission',
			id: { name },
			options: { $select: 'id' },
		})
	)?.id;

const getGuestDirectPermissionIds = async (guestId: number) =>
	(
		await authApi.get({
			resource: 'user__has__permission',
			options: { $select: 'permission', $filter: { user: guestId } },
		})
	).map(({ permission }) => permission.__id);

const getGuestRoles = (guestId: number) =>
	authApi.get({
		resource: 'user__has__role',
		options: { $select: ['role', 'expiry_date'], $filter: { user: guestId } },
	});

export default () => {
	describe('guest role', () => {
		let guestId: number;

		before(async () => {
			const guest = await authApi.get({
				resource: 'user',
				id: { username: 'guest' },
				options: { $select: 'id' },
			});
			assertExists(guest);
			guestId = guest.id;
		});

		it('should give the guest user exactly the guest role and no direct permissions', async () => {
			const roles = await authApi.get({
				resource: 'role',
				options: {
					$select: 'name',
					$filter: {
						is_of__user: {
							$any: { $alias: 'uhr', $expr: { uhr: { user: guestId } } },
						},
					},
				},
			});
			expect(roles.map(({ name }) => name)).to.deep.equal(['guest']);

			expect(await getGuestDirectPermissionIds(guestId)).to.deep.equal([]);

			// Sort both sides in JS, as the query orders by the database collation
			const guestPermissions = await permissions.getUserPermissions(guestId);
			expect(guestPermissions.toSorted()).to.deep.equal(ROLES.guest.toSorted());
		});

		it('should apply the guest role permissions to anonymous requests', async () => {
			// Pine memoizes the guest permissions on the first guest request, so on a
			// fresh database (the test default) this also checks that no guest request
			// at startup ran before the role sync
			const { body } = await supertest()
				.get('/resin/device_type?$select=slug')
				.expect(200);
			expect(body.d).to.not.be.empty;
		});

		describe('when createAllPermissions runs again', () => {
			const orphanPermissionName = `test.guest-direct-${randomUUID()}`;
			const rolePermissionName = ROLES.guest[0];
			const extraRoleName = `test-guest-extra-${randomUUID()}`;

			// Same arguments as the startup sync in init.ts
			const syncPermissions = () =>
				sbvrUtils.db.transaction((tx) =>
					createAllPermissions(
						tx,
						_.union(
							Object.values(ROLES).flat(),
							Object.values(KEYS).flatMap((key) => key.permissions),
						),
						ROLES,
						KEYS,
						{},
					),
				);

			after(async () => {
				// Clean up in case a test failed before the sync fixed things
				const extraRole = await authApi.get({
					resource: 'role',
					id: { name: extraRoleName },
					options: { $select: 'id' },
				});
				if (extraRole != null) {
					await authApi.delete({
						resource: 'user__has__role',
						options: { $filter: { role: extraRole.id } },
					});
					await authApi.delete({ resource: 'role', id: extraRole.id });
				}
				await authApi.patch({
					resource: 'user__has__role',
					options: {
						$filter: {
							user: guestId,
							role: { $any: { $alias: 'r', $expr: { r: { name: 'guest' } } } },
						},
					},
					body: { expiry_date: null },
				});
				// Clean up in case the test failed before the sync removed them
				const orphanPermissionId = await getPermissionId(orphanPermissionName);
				if (orphanPermissionId != null) {
					await authApi.delete({
						resource: 'user__has__permission',
						options: { $filter: { permission: orphanPermissionId } },
					});
					await authApi.delete({
						resource: 'permission',
						id: orphanPermissionId,
					});
				}
				const rolePermissionId = await getPermissionId(rolePermissionName);
				if (rolePermissionId != null) {
					await authApi.delete({
						resource: 'user__has__permission',
						options: {
							$filter: { user: guestId, permission: rolePermissionId },
						},
					});
				}
			});

			it('should remove direct guest permissions and delete the ones nothing else references', async () => {
				const { orphanPermissionId, rolePermissionId } =
					await sbvrUtils.db.transaction(async (tx) => {
						const orphanPermission = await getOrInsertPermissionId(
							orphanPermissionName,
							tx,
						);
						await assignUserPermission(guestId, orphanPermission.id, tx);
						// A direct permission that the guest role also grants
						const rolePermission = await getOrInsertPermissionId(
							rolePermissionName,
							tx,
						);
						await assignUserPermission(guestId, rolePermission.id, tx);
						return {
							orphanPermissionId: orphanPermission.id,
							rolePermissionId: rolePermission.id,
						};
					});
				expect(
					(await getGuestDirectPermissionIds(guestId)).toSorted(),
				).to.deep.equal([orphanPermissionId, rolePermissionId].toSorted());

				await syncPermissions();

				expect(await getGuestDirectPermissionIds(guestId)).to.deep.equal([]);
				expect(await getPermissionId(orphanPermissionName)).to.equal(undefined);
				// Still granted through the guest role, so it must be kept
				expect(await getPermissionId(rolePermissionName)).to.equal(
					rolePermissionId,
				);
			});

			it('should replace other guest roles and an expired guest role with just the guest role', async () => {
				const guestRoleId = await sbvrUtils.db.transaction(async (tx) => {
					const guestRole = await getOrInsertRoleId('guest', tx);
					const extraRole = await getOrInsertRoleId(extraRoleName, tx);
					await assignUserRole(guestId, extraRole.id, tx);
					// Pine ignores expired roles, so this would leave the guest without
					// permissions
					await authApi.patch({
						resource: 'user__has__role',
						passthrough: { req: permissions.root, tx },
						options: { $filter: { user: guestId, role: guestRole.id } },
						body: { expiry_date: new Date(Date.now() - 60_000) },
					});
					return guestRole.id;
				});
				expect(await getGuestRoles(guestId)).to.have.length(2);

				await syncPermissions();

				expect(await getGuestRoles(guestId)).to.deep.equal([
					{ role: { __id: guestRoleId }, expiry_date: null },
				]);
				const guestPermissions = await permissions.getUserPermissions(guestId);
				expect(guestPermissions.toSorted()).to.deep.equal(
					ROLES.guest.toSorted(),
				);
			});
		});
	});
};

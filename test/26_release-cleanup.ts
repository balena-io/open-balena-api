import * as versions from './test-lib/versions.js';
import * as fixtures from './test-lib/fixtures.js';
import { expectNewSettledTasks } from './test-lib/api-helpers.js';

export default () => {
	versions.test((version, pineTest) => {
		if (version !== 'resin') {
			return;
		}

		describe('release cleanup', () => {
			const ctx: AnyObject = {};
			let pineUser: typeof pineTest;

			before(async function () {
				const fx = await fixtures.load('26-release-cleanup');
				ctx.loadedFixtures = fx;
				ctx.admin = fx.users.admin;
				pineUser = pineTest.clone({
					passthrough: {
						user: ctx.admin,
					},
				});
				ctx.app1 = fx.applications.app1;
				ctx.release1 = fx.releases.release1;
				ctx.release2 = fx.releases.release2;
			});

			after(async () => {
				await fixtures.clean(ctx.loadedFixtures);
			});

			it('should mark images for deletion', async () => {
				// Pin application to release2 so we know we can safely delete release1
				await pineUser
					.patch({
						resource: 'application',
						id: ctx.app1.id,
						body: {
							should_be_running__release: ctx.release2.id,
						},
					})
					.expect(200);

				// Get images associated with release we are going to delete
				const { body: images } = await pineUser.get({
					resource: 'image',
					options: {
						$filter: {
							release_image: {
								$any: {
									$alias: 'ri',
									$expr: {
										ri: {
											is_part_of__release: ctx.release1.id,
										},
									},
								},
							},
						},
					},
				});

				// Delete release1 and assert all associated images were marked for deletion
				await pineUser
					.delete({ resource: 'release', id: ctx.release1.id })
					.expect(200);
				await expectNewSettledTasks('delete_registry_images', [
					{
						is_executed_with__parameter_set: {
							images: images.map((image) => image.id),
						},
						status: 'succeeded',
					},
				]);
			});
		});
	});
};

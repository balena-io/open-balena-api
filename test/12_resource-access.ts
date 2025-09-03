import _ from 'lodash';
import { expect } from 'chai';
import * as fixtures from './test-lib/fixtures.js';
import { supertest } from './test-lib/supertest.js';
import * as versions from './test-lib/versions.js';

export default () => {
	versions.test((version) => {
		describe('resource access', function () {
			before(async function () {
				const fx = await fixtures.load('12-resource-access');
				this.loadedFixtures = fx;
				this.user = fx.users.admin;
				this.application1 = fx.applications.app1;
				this.application2 = fx.applications.app2;
			});

			after(async function () {
				await fixtures.clean(this.loadedFixtures);
			});

			[
				{
					title: 'application',
					odataPart: `application?$select=id&$filter=not is_host&$orderby=app_name asc`,
				},
				{
					title: 'my_application',
					odataPart: `my_application?$select=id&$orderby=app_name asc`,
					errorCode: version !== 'v6' ? 401 : undefined,
				},
				{
					title: 'user__has_direct_access_to__application',
					odataPart: `user__has_direct_access_to__application?$select=has_direct_access_to__application&$orderby=has_direct_access_to__application/app_name asc`,
					appIdField: 'has_direct_access_to__application.__id',
				},
				{
					title:
						'application when filtering by is_directly_accessible_by__user',
					odataPart: `application?$select=id&$filter=is_directly_accessible_by__user/any(dau:true)&$orderby=app_name asc`,
				},
			].forEach(({ title, odataPart, appIdField = 'id', errorCode }) => {
				describe(`${title} access`, function () {
					if (errorCode != null) {
						it(`should not be able to get applications via /${version}/${title}`, async function () {
							await supertest(this.user)
								.get(`/${version}/${odataPart}`)
								.expect(errorCode);
						});
					} else {
						it(`should be able to see all applications in /${version}/${title}`, async function () {
							const {
								body: { d },
							} = await supertest(this.user)
								.get(`/${version}/${odataPart}`)
								.expect(200);

							const expectedAppIds = [
								this.application1.id,
								this.application2.id,
							];

							expect(d)
								.to.be.an('array')
								.that.has.length(expectedAppIds.length);

							const apps = d.map((item: AnyObject) => {
								expect(item)
									.to.have.nested.property(appIdField)
									.that.is.a('number');
								return _.get(item, appIdField);
							});
							expect(apps).to.deep.equal(expectedAppIds);
						});
					}
				});
			});

			describe(`user__has_direct_access_to__application`, function () {
				it('should have the correct format', async function () {
					const {
						body: { d },
					} = await supertest(this.user)
						.get(`/${version}/user__has_direct_access_to__application`)
						.expect(200);

					expect(d).to.be.an('array').that.has.length(2);
					d.forEach((userAccessibleApp: AnyObject) => {
						expect(userAccessibleApp).to.have.property('id').that.is.null;
						expect(userAccessibleApp)
							.to.have.nested.property('user.__id')
							.that.is.equal(this.user.id);
						expect(userAccessibleApp)
							.to.have.nested.property('has_direct_access_to__application.__id')
							.that.is.a('number');
					});
				});
			});
		});
	});
};

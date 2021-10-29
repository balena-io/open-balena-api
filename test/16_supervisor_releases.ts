import { expect } from './test-lib/chai';
import * as fixtures from './test-lib/fixtures';
import * as fakeDevice from './test-lib/fake-device';
import { supertest } from './test-lib/supertest';
import { version } from './test-lib/versions';

describe('Devices running supervisor releases', () => {
	const ctx: AnyObject = {};
	let device: fakeDevice.Device;
	let device2: fakeDevice.Device;
	let device3: fakeDevice.Device;
	let device4: fakeDevice.Device;

	before(async () => {
		const fx = await fixtures.load('16-supervisor-app');
		ctx.fixtures = fx;
		ctx.admin = fx.users.admin;
		ctx.deviceApp = fx.applications.app1;
		ctx.supervisorReleases = ctx.fixtures['releases'];
		device = await fakeDevice.provisionDevice(ctx.admin, ctx.deviceApp.id);
		device2 = await fakeDevice.provisionDevice(ctx.admin, ctx.deviceApp.id);
		device3 = await fakeDevice.provisionDevice(ctx.admin, ctx.deviceApp.id);
		device4 = await fakeDevice.provisionDevice(ctx.admin, ctx.deviceApp.id);
	});

	after(async () => {
		await fixtures.clean({ devices: [device, device2, device3, device4] });
		await fixtures.clean(ctx.fixtures);
	});

	describe('Devices running supervisor releases', () => {
		it('should be provisioned with a non-null supervisor release after device PATCH', async () => {
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send({
					os_version: '2.38.0+rev1',
					supervisor_version: '5.0.1',
				})
				.expect(200);

			const {
				body: {
					d: [deviceInfo],
				},
			} = await supertest(ctx.admin).get(
				`/${version}/device(${device.id})?$select=should_be_managed_by__release,supervisor_version`,
			);
			expect(deviceInfo).to.have.property('should_be_managed_by__release').that
				.is.not.null;
			const nativeSupervisorRes = await supertest(ctx.admin).get(
				`/${version}/release(${deviceInfo.should_be_managed_by__release.__id})?$select=release_version`,
			);
			expect(nativeSupervisorRes.body)
				.to.have.nested.property('d[0].release_version')
				.that.equals(`v${deviceInfo.supervisor_version}`);
		});

		it('should be set to a non-null supervisor release after state endpoint PATCH', async () => {
			await device2.patchStateV2({
				local: {
					api_port: 48484,
					api_secret: 'somesecret',
					os_version: '2.38.0+rev1',
					os_variant: 'dev',
					supervisor_version: '5.0.1',
					provisioning_progress: null,
					provisioning_state: '',
					status: 'Idle',
					logs_channel: null,
					update_failed: false,
					update_pending: false,
					update_downloaded: false,
				},
			});

			const res = await supertest(ctx.admin).get(
				`/${version}/device(${device2.id})`,
			);
			const nativeSupervisorRes = await supertest(ctx.admin).get(
				`/${version}/release(${res.body.d[0].should_be_managed_by__release.__id})?$select=release_version`,
			);
			expect(nativeSupervisorRes.body)
				.to.have.nested.property('d[0].release_version')
				.that.equals(`v${res.body.d[0].supervisor_version}`);
		});

		it('should allow upgrading to a logstream version', async () => {
			const patch = {
				should_be_managed_by__release:
					ctx.supervisorReleases['6.0.1_logstream'].id,
			};
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send(patch)
				.expect(200);
			const res = await supertest(ctx.admin).get(
				`/${version}/device(${device.id})`,
			);
			expect(res.body)
				.to.have.nested.property('d[0].should_be_managed_by__release.__id')
				.that.equals(ctx.supervisorReleases['6.0.1_logstream'].id);
		});

		it('should provision to a _logstream supervisor edition', async () => {
			await device4.patchStateV2({
				local: {
					api_port: 48484,
					api_secret: 'somesecret',
					os_version: '2.38.0+rev1',
					os_variant: 'dev',
					supervisor_version: '6.0.1',
					provisioning_progress: null,
					provisioning_state: '',
					status: 'Idle',
					logs_channel: null,
					update_failed: false,
					update_pending: false,
					update_downloaded: false,
				},
			});

			const res = await supertest(ctx.admin).get(
				`/${version}/device(${device4.id})`,
			);
			expect(res.body)
				.to.have.nested.property('d[0].should_be_managed_by__release.__id')
				.that.equals(ctx.supervisorReleases['6.0.1_logstream'].id);
		});

		it("should allow upgrading a device's supervisor release", async () => {
			const patch = {
				should_be_managed_by__release: ctx.supervisorReleases['7.0.1'].id,
			};
			const patch2 = {
				should_be_managed_by__release: ctx.supervisorReleases['8.0.1'].id,
			};
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send(patch)
				.expect(200);
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send(patch2)
				.expect(200);
			const res = await supertest(ctx.admin).get(
				`/${version}/device(${device.id})`,
			);
			expect(res.body)
				.to.have.nested.property('d[0].should_be_managed_by__release.__id')
				.that.equals(ctx.supervisorReleases['8.0.1'].id);
		});

		it('should provision to an invalidated release', async () => {
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send({
					supervisor_version: null,
					should_be_managed_by__release: null,
				})
				.expect(200);
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send({
					supervisor_version: '8.1.1',
				})
				.expect(200);
			const { body } = await supertest(ctx.admin)
				.get(`/${version}/device(${device.id})`)
				.expect(200);
			expect(body).to.have.nested.property('d[0].should_be_managed_by__release')
				.that.is.not.null;
		});

		it('should not allow upgrading to a release without a release version', async () => {
			const patch = {
				should_be_managed_by__release: ctx.supervisorReleases['no_version'].id,
			};
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send(patch)
				.expect(400);
		});

		it('should not allow upgrading to a different architecture', async () => {
			const patch = {
				should_be_managed_by__release: ctx.supervisorReleases['12.1.1'].id,
			};
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send(patch)
				.expect(400);
		});

		it('should not allow upgrading to an invalidated release', async () => {
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device3.id})`)
				.send({
					supervisor_version: '8.0.1',
				})
				.expect(200);
			const patch = {
				should_be_managed_by__release: ctx.supervisorReleases['8.1.1'].id,
			};
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device3.id})`)
				.send(patch)
				.expect(400);
		});

		it('should not allow setting a supervisor native release to a non-public app', async () => {
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send({
					should_be_managed_by__release:
						ctx.supervisorReleases['user_release'].id,
				})
				.expect(400);
		});

		it('should not allow setting a supervisor native release to a hostapp', async () => {
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send({
					should_be_managed_by__release:
						ctx.supervisorReleases['hostapp_release'].id,
				})
				.expect(400);
		});

		it('should fail if supervisor release does not exist', async () => {
			const fakeId = 999;
			const patch = {
				should_be_managed_by__release: fakeId,
			};
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send(patch)
				.expect(400);
		});

		it('should not allow downgrading a supervisor version', async () => {
			const patch = {
				should_be_managed_by__release: ctx.supervisorReleases['7.0.1'].id,
			};
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send(patch)
				.expect(400);
		});

		it('should correctly determine logstream values', async () => {
			const patch = {
				should_be_managed_by__release:
					ctx.supervisorReleases['6.0.1_logstream'].id,
			};
			await supertest(ctx.admin)
				.patch(`/${version}/device(${device.id})`)
				.send(patch)
				.expect(400);
		});
	});
});

import { expect } from 'chai';

import { supertest } from './test-lib/supertest';

const checkBaseVarsResult = (
	vars: AnyObject,
	extraConfigVarSchemaProperties: string[] = [],
) => {
	expect(vars).to.be.an('object');
	expect(vars).to.have.property('reservedNames').that.is.an('array');
	expect(vars).to.have.property('reservedNamespaces').that.is.an('array');
	expect(vars).to.have.property('whiteListedNames').that.is.an('array');
	expect(vars).to.have.property('whiteListedNamespaces').that.is.an('array');
	expect(vars).to.have.property('blackListedNames').that.is.an('array');

	expect(vars.reservedNames.sort()).to.deep.equal(['BALENA', 'RESIN', 'USER']);

	expect(vars.reservedNamespaces.sort()).to.deep.equal(['BALENA_', 'RESIN_']);

	expect(vars.whiteListedNames.sort()).to.deep.equal([
		'BALENA_APP_RESTART_POLICY',
		'BALENA_APP_RESTART_RETRIES',
		'BALENA_DEPENDENT_DEVICES_HOOK_ADDRESS',
		'BALENA_OVERRIDE_LOCK',
		'BALENA_SUPERVISOR_CONNECTIVITY_CHECK',
		'BALENA_SUPERVISOR_DEVELOPMENT_MODE',
		'BALENA_SUPERVISOR_HANDOVER_TIMEOUT',
		'BALENA_SUPERVISOR_HARDWARE_METRICS',
		'BALENA_SUPERVISOR_INSTANT_UPDATE_TRIGGER',
		'BALENA_SUPERVISOR_LOCAL_MODE',
		'BALENA_SUPERVISOR_LOG_CONTROL',
		'BALENA_SUPERVISOR_PERSISTENT_LOGGING',
		'BALENA_SUPERVISOR_POLL_INTERVAL',
		'BALENA_SUPERVISOR_UPDATE_STRATEGY',
		'BALENA_SUPERVISOR_VPN_CONTROL',
		'RESIN_APP_RESTART_POLICY',
		'RESIN_APP_RESTART_RETRIES',
		'RESIN_DEPENDENT_DEVICES_HOOK_ADDRESS',
		'RESIN_OVERRIDE_LOCK',
		'RESIN_SUPERVISOR_CONNECTIVITY_CHECK',
		'RESIN_SUPERVISOR_DEVELOPMENT_MODE',
		'RESIN_SUPERVISOR_HANDOVER_TIMEOUT',
		'RESIN_SUPERVISOR_HARDWARE_METRICS',
		'RESIN_SUPERVISOR_INSTANT_UPDATE_TRIGGER',
		'RESIN_SUPERVISOR_LOCAL_MODE',
		'RESIN_SUPERVISOR_LOG_CONTROL',
		'RESIN_SUPERVISOR_PERSISTENT_LOGGING',
		'RESIN_SUPERVISOR_POLL_INTERVAL',
		'RESIN_SUPERVISOR_UPDATE_STRATEGY',
		'RESIN_SUPERVISOR_VPN_CONTROL',
	]);

	expect(vars.whiteListedNamespaces.sort()).to.deep.equal([
		'BALENA_HOST_',
		'BALENA_UI_',
		'RESIN_HOST_',
		'RESIN_UI_',
	]);

	expect(vars.blackListedNames.sort()).to.deep.equal([
		'BALENA_DEVICE_RESTART',
		'BALENA_HOST_LOG_TO_DISPLAY',
		'BALENA_RESTART',
		'BALENA_SUPERVISOR_NATIVE_LOGGER',
		'BALENA_SUPERVISOR_OVERRIDE_LOCK',
		'RESIN_DEVICE_RESTART',
		'RESIN_HOST_LOG_TO_DISPLAY',
		'RESIN_RESTART',
		'RESIN_SUPERVISOR_NATIVE_LOGGER',
		'RESIN_SUPERVISOR_OVERRIDE_LOCK',
	]);

	expect(vars).to.have.property('configVarSchema').that.is.an('object');

	const { configVarSchema } = vars;

	expect(configVarSchema).to.have.property('type', 'object');
	expect(configVarSchema).to.have.property(
		'$schema',
		'http://json-schema.org/draft-06/schema#',
	);
	expect(configVarSchema).to.have.property('properties').that.is.an('object');

	const configVarSchemaKeys = Object.keys(configVarSchema.properties).sort();
	expect(configVarSchemaKeys).to.deep.equal(
		[
			'BALENA_SUPERVISOR_HARDWARE_METRICS',
			'BALENA_SUPERVISOR_DEVELOPMENT_MODE',
			'BALENA_HOST_SPLASH_IMAGE',
			'RESIN_OVERRIDE_LOCK',
			'RESIN_SUPERVISOR_CONNECTIVITY_CHECK',
			'RESIN_SUPERVISOR_INSTANT_UPDATE_TRIGGER',
			'RESIN_SUPERVISOR_LOG_CONTROL',
			'RESIN_SUPERVISOR_PERSISTENT_LOGGING',
			'RESIN_SUPERVISOR_POLL_INTERVAL',
			'RESIN_SUPERVISOR_VPN_CONTROL',
			...extraConfigVarSchemaProperties,
		].sort(),
	);
};

describe('Basic', () => {
	it('check /ping route is OK', async () => {
		const res = await supertest().get('/ping').expect(200);
		expect(res.text).to.equal('OK');
	});

	describe('/config/vars', function () {
		it('should be correct when no device type is provided', async () => {
			const { body: vars } = await supertest().get('/config/vars').expect(200);

			checkBaseVarsResult(vars);
		});

		[
			{ deviceType: 'beaglebone-black' },
			{
				deviceType: 'fincm3',
				extraConfigVarSchemaProperties: [
					'BALENA_HOST_CONFIG_display_rotate',
					'BALENA_HOST_CONFIG_hdmi_cvt',
					'BALENA_HOST_CONFIG_hdmi_force_hotplug',
					'BALENA_HOST_CONFIG_hdmi_group',
					'BALENA_HOST_CONFIG_hdmi_mode',
					'RESIN_HOST_CONFIG_disable_splash',
					'RESIN_HOST_CONFIG_dtparam',
					'RESIN_HOST_CONFIG_dtoverlay',
					'RESIN_HOST_CONFIG_enable_uart',
					'RESIN_HOST_CONFIG_gpu_mem',
				],
			},
			{
				deviceType: 'jetson-nano',
				extraConfigVarSchemaProperties: ['RESIN_HOST_EXTLINUX_fdt'],
			},
			{
				deviceType: 'jetson-tx2',
				extraConfigVarSchemaProperties: [
					'RESIN_HOST_EXTLINUX_fdt',
					'RESIN_HOST_ODMDATA_configuration',
				],
			},
			{
				deviceType: 'up-board',
				extraConfigVarSchemaProperties: ['RESIN_HOST_CONFIGFS_ssdt'],
			},
		].forEach(({ deviceType, extraConfigVarSchemaProperties }) => {
			it(`should be correct when device type ${deviceType} is specified`, async () => {
				const { body: vars } = await supertest()
					.get(`/config/vars?deviceType=${deviceType}`)
					.expect(200);

				checkBaseVarsResult(vars, extraConfigVarSchemaProperties);
			});
		});
	});
});

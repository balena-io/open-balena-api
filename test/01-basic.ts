import 'mocha';
import { app } from '../init';
import { expect } from 'chai';

import supertest = require('./test-lib/supertest');

describe('Basic', () => {
	it('check /ping route is OK', () => {
		return supertest(app)
			.get('/ping')
			.expect(200)
			.then(res => {
				expect(res.text).to.equal('OK');
			});
	});

	it('check /config/vars are correct', () => {
		return supertest(app)
			.get('/config/vars')
			.expect(200)
			.expect(res => {
				expect(res.body).to.be.an('object');
				expect(res.body)
					.to.have.property('reservedNames')
					.that.is.an('array');
				expect(res.body)
					.to.have.property('reservedNamespaces')
					.that.is.an('array');
				expect(res.body)
					.to.have.property('whiteListedNames')
					.that.is.an('array');
				expect(res.body)
					.to.have.property('whiteListedNamespaces')
					.that.is.an('array');
				expect(res.body)
					.to.have.property('blackListedNames')
					.that.is.an('array');

				expect(res.body.reservedNames.sort()).to.deep.equal([
					'BALENA',
					'RESIN',
					'USER',
				]);

				expect(res.body.reservedNamespaces.sort()).to.deep.equal([
					'BALENA_',
					'RESIN_',
				]);

				expect(res.body.whiteListedNames.sort()).to.deep.equal([
					'BALENA_APP_RESTART_POLICY',
					'BALENA_APP_RESTART_RETRIES',
					'BALENA_DEPENDENT_DEVICES_HOOK_ADDRESS',
					'BALENA_SUPERVISOR_CONNECTIVITY_CHECK',
					'BALENA_SUPERVISOR_HANDOVER_TIMEOUT',
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
					'RESIN_SUPERVISOR_CONNECTIVITY_CHECK',
					'RESIN_SUPERVISOR_HANDOVER_TIMEOUT',
					'RESIN_SUPERVISOR_INSTANT_UPDATE_TRIGGER',
					'RESIN_SUPERVISOR_LOCAL_MODE',
					'RESIN_SUPERVISOR_LOG_CONTROL',
					'RESIN_SUPERVISOR_PERSISTENT_LOGGING',
					'RESIN_SUPERVISOR_POLL_INTERVAL',
					'RESIN_SUPERVISOR_UPDATE_STRATEGY',
					'RESIN_SUPERVISOR_VPN_CONTROL',
				]);

				expect(res.body.whiteListedNamespaces.sort()).to.deep.equal([
					'BALENA_HOST_',
					'BALENA_UI_',
					'RESIN_HOST_',
					'RESIN_UI_',
				]);

				expect(res.body.blackListedNames.sort()).to.deep.equal([
					'BALENA_DEVICE_RESTART',
					'BALENA_HOST_LOG_TO_DISPLAY',
					'BALENA_OVERRIDE_LOCK',
					'BALENA_RESTART',
					'BALENA_SUPERVISOR_NATIVE_LOGGER',
					'BALENA_SUPERVISOR_OVERRIDE_LOCK',
					'RESIN_DEVICE_RESTART',
					'RESIN_HOST_LOG_TO_DISPLAY',
					'RESIN_OVERRIDE_LOCK',
					'RESIN_RESTART',
					'RESIN_SUPERVISOR_NATIVE_LOGGER',
					'RESIN_SUPERVISOR_OVERRIDE_LOCK',
				]);
			});
	});
});

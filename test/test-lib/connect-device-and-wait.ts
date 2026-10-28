import { expect } from 'chai';
import { getMockServer } from './mockttp-server.ts';
import { supertest } from './supertest.ts';

import { VPN_SERVICE_API_KEY } from '../../src/lib/config.ts';
import { waitFor, TimedOutError } from './common.ts';

const registerService = async (version: string) => {
	const res = await supertest()
		.post(`/${version}/service_instance`)
		.query({ apikey: VPN_SERVICE_API_KEY })
		.expect(201);

	expect(res.body).to.have.property('id').that.is.a('number');

	return res.body.id;
};

export const connectDeviceAndWaitForUpdate = async (
	uuid: string,
	version: string,
	/** An action that should trigger a device update. */
	promiseFn: () => PromiseLike<any>,
) => {
	let updateRequested = false;

	const serviceId = await registerService(version);
	await supertest()
		.post('/services/vpn/client-connect')
		.query({ apikey: VPN_SERVICE_API_KEY })
		.send({
			uuids: [uuid],
			serviceId,
		})
		.expect(200);

	// The device-proxy tunnels to `${uuid}.balena` through the VPN connect-proxy,
	// which the mock server listens on (see mockttp-server), so the request lands
	// here even though it uses an explicit (non-env) proxy.
	await getMockServer()
		.forPost(/\/v1\/update/)
		.forHostname(`${uuid}.balena`)
		.once()
		.thenCallback(() => {
			updateRequested = true;
			return {
				statusCode: 200,
				body: 'OK',
				headers: { 'content-type': 'text/plain' },
			};
		});
	await promiseFn();

	try {
		await waitFor({
			checkFn: () => updateRequested,
		});
	} catch (err) {
		if (err instanceof TimedOutError) {
			throw new Error('Request to update device never happened');
		} else {
			throw err;
		}
	}
};

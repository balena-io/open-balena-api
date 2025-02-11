import { expect } from 'chai';
import nock from 'nock';
import { supertest } from './supertest.js';

import { VPN_SERVICE_API_KEY } from '@balena/open-balena-api/config';
import { waitFor, TimedOutError } from './common.js';

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

	nock(`http://${uuid}.balena`)
		.post(/\/v1\/update/)
		.reply(() => {
			updateRequested = true;
			return [
				{
					statusCode: 200,
					headers: { 'content-type': 'text/plain' },
				},
				'OK',
			];
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

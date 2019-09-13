import * as Bluebird from 'bluebird';
import { expect, assert } from './chai';

import requestmock = require('./requestmock');
import supertest = require('./supertest');

import { app } from '../../init';
import { VPN_SERVICE_API_KEY } from '../../dist/lib/config';

const registerService = async (version: string = 'resin') => {
	const res = await supertest(app)
		.post(`/${version}/service_instance`)
		.query({ apikey: VPN_SERVICE_API_KEY })
		.expect(201);

	expect(res.body)
		.to.have.property('id')
		.that.is.a('number');

	return res.body.id;
};

export const connectDeviceAndWaitForUpdate = async (
	uuid: string,
	promise: () => Promise<void>,
	version: string = 'resin',
) => {
	let updateRequested = false;

	const serviceId = await registerService(version);
	await supertest(app)
		.post('/services/vpn/client-connect')
		.query({ apikey: VPN_SERVICE_API_KEY })
		.send({
			common_name: uuid,
			virtual_address: '10.10.10.1',
			service_id: serviceId,
		})
		.expect(200);

	requestmock.register(
		'post',
		`http://${uuid}.balena:80/v1/update`,
		(_args, cb) => {
			updateRequested = true;
			cb(
				null,
				{
					statusCode: 200,
					headers: { 'content-type': 'text/plain' },
				},
				'OK',
			);
		},
	);

	await promise();

	for (let i = 0; i < 20; i++) {
		await Bluebird.delay(500);

		if (updateRequested) {
			break;
		}
	}

	requestmock.deregister('post', `http://${uuid}.balena:80/v1/update`);

	assert(updateRequested, `Device ${uuid} was not polled for update`);
	return Promise.resolve();
};

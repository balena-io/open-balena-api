import supertest = require('./supertest');
import { expect } from 'chai';
import * as express from 'express';
import * as Bluebird from 'bluebird';
import * as uuid from 'node-uuid';

export const createModel = (
	app: express.Express,
	auth: string,
	resource: string,
	model: AnyObject,
) => {
	return supertest(app, auth)
		.post(`/resin/${resource}`)
		.set('Content-Type', 'application/json')
		.send(model)
		.expect(201);
};

export type ApplicationModel = {
	device_type: string;
	app_name: string;
	application_type: number;
};

export type DeviceModel = {
	device_type: string;
	belongs_to__application: number;
};

export type ReleaseModel = {
	belongs_to__application: number;
	commit: string;
	status: 'success' | 'failed' | 'pending';
};

export const createDevice = (
	app: express.Express,
	auth: string,
	device: DeviceModel,
) => createModel(app, auth, 'device', device);
export const createApplication = (
	app: express.Express,
	auth: string,
	application: ApplicationModel,
) => createModel(app, auth, 'application', application);
export const createRelease = (
	app: express.Express,
	auth: string,
	release: ReleaseModel,
	services: string[],
) =>
	createModel(app, auth, 'release', {
		...{ composition: '', source: '', start_timestamp: new Date() },
		...release,
	}).then(r => {
		return Bluebird.map(services, serviceName =>
			supertest(app, auth)
				.get(
					`/resin/service?$filter=service_name eq '${serviceName}' and application eq ${release.belongs_to__application}`,
				)
				.expect(200)
				.then(res => {
					if (res.body.d[0] != undefined) {
						return res.body.d[0];
					}

					return createModel(app, auth, 'service', {
						application: release.belongs_to__application,
						service_name: serviceName,
					}).then(res => res.body);
				}),
		)
			.then(results => {
				const services: AnyObject = {};
				results.forEach(s => {
					services[s.service_name] = s.id;
				});
				return { ...r.body, ...{ services } };
			})
			.then(release =>
				Bluebird.map(services, service => {
					const serviceId = release.services[service] as number;

					return supertest(app, auth)
						.post('/resin/image')
						.send({
							is_a_build_of__service: serviceId,
							is_part_of__release: release.id,
							start_timestamp: Date.now(),
							end_timestamp: Date.now(),
							push_timestamp: Date.now(),
							project_type: 'test project type',
							is_stored_at__image_location: `multi-image-location-${serviceId}`,
							status: 'success',
						})
						.expect(201)
						.then(res => {
							expect(res.body)
								.to.have.property('id')
								.that.is.a('number');
							return { image: res.body.id as number, service };
						});
				})
					.then(images => {
						return { ...release, ...{ images } };
					})
					.then(release =>
						Bluebird.each(release.images, (image: AnyObject) =>
							supertest(app, auth)
								.post('/resin/image__is_part_of__release')
								.send({
									image: image.image,
									is_part_of__release: release.id,
								})
								.expect(201)
								.then(res => {
									expect(res.body)
										.to.have.property('id')
										.that.is.a('number');
								}),
						).then(() => release),
					),
			);
	});

export const createProvisioningKey = (
	app: express.Express,
	auth: string,
	appId: number,
) =>
	supertest(app, auth)
		.post(`/api-key/application/${appId}/provisioning`)
		.expect(200)
		.then(res => {
			const provisioningKey = res.body as string;

			return {
				provisioningKey,
				createDevice: (device: {
					api_key: string;
					device_type: string;
					user: number;
					uuid?: string;
				}) => {
					const body = {
						...{
							uuid: uuid
								.v4()
								.replace(/\-/g, '')
								.toLowerCase(),
							application: appId,
						},
						...device,
					};

					return supertest(app, auth)
						.post(`/device/register?apikey=${provisioningKey}`)
						.send(body)
						.expect(201)
						.then(res =>
							supertest(app, auth)
								.get(`/resin/device(${res.body.id})`)
								.expect(200)
								.then(res => res.body.d[0]),
						);
				},
			};
		});

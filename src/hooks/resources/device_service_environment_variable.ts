import * as Promise from 'bluebird';

import { sbvrUtils } from '../../platform';

class ServiceInstallNotFoundError extends Error {}

const getDeviceServiceFromServiceInstall = (
	api: sbvrUtils.PinejsClient,
	id: number,
) => {
	return api
		.get({
			resource: 'service_install',
			id,
		})
		.then((serviceInstall: AnyObject) => {
			if (serviceInstall == null) {
				throw new ServiceInstallNotFoundError();
			}

			return {
				device: serviceInstall.device['__id'],
				service: serviceInstall.installs__service['__id'],
			};
		});
};

const getServiceInstallFromDeviceService = (
	api: sbvrUtils.PinejsClient,
	device: number,
	service: number,
) =>
	api
		.get({
			resource: 'service_install',
			options: {
				$top: 1,
				$select: 'id',
				$filter: {
					device,
					installs__service: service,
				},
			},
		})
		.then(([si]: AnyObject[]) => {
			if (si != null) {
				return si.id;
			}

			return api
				.post({
					resource: 'service_install',
					body: {
						device,
						installs__service: service,
					},
				})
				.then((si: AnyObject) => si.id);
		});

sbvrUtils.addPureHook('POST', 'resin', 'device_service_environment_variable', {
	POSTPARSE: args => {
		const waitPromises: Array<PromiseLike<any>> = [];
		const { api, request } = args;

		if (request.values.service_install != null) {
			waitPromises.push(
				getDeviceServiceFromServiceInstall(
					api,
					request.values.service_install,
				).then(serviceInstall => {
					const { device, service } = serviceInstall;

					request.values.belongs_to__device = device;
					request.values.applies_to__service = service;
				}),
			);
		} else if (
			request.values.belongs_to__device != null &&
			request.values.applies_to__service != null
		) {
			waitPromises.push(
				getServiceInstallFromDeviceService(
					api,
					request.values.belongs_to__device,
					request.values.applies_to__service,
				).then(si => {
					request.values.service_install = si;
				}),
			);
		}

		return Promise.all(waitPromises);
	},

	PRERUN: args => {
		const waitPromises: Array<PromiseLike<any>> = [];
		const { request, api, tx } = args;

		if (
			request.values.belongs_to__device != null &&
			request.values.applies_to__service != null
		) {
			const { belongs_to__device, applies_to__service } = request.values;
			const deviceServiceIds = {
				device: belongs_to__device,
				installs__service: applies_to__service,
			};

			waitPromises.push(
				api
					.get({
						resource: 'service_install/$count',
						options: {
							$filter: deviceServiceIds,
						},
					})
					.then(count => {
						if (count == 0) {
							return api
								.post({
									resource: 'service_install',
									body: deviceServiceIds,
									passthrough: {
										tx,
									},
								})
								.return();
						}
					}),
			);
		}

		return Promise.all(waitPromises);
	},
});

sbvrUtils.addPureHook('PATCH', 'resin', 'device_service_environment_variable', {
	PREPARSE: args => {
		const waitPromises: Array<PromiseLike<any>> = [];
		const { api, request } = args;

		if (request.values.service_install !== null) {
			waitPromises.push(
				api
					.get({
						resource: 'service_install',
						id: request.values.service_install as number,
					})
					.then(
						(serviceInstall: { device: number; installs__service: number }) => {
							const { device, installs__service } = serviceInstall;

							request.values.belongs_to__device = device;
							request.values.applies_to__service = installs__service;
						},
					),
			);
		}

		return Promise.all(waitPromises);
	},
});

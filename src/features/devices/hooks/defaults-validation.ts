import { hooks, errors } from '@balena/pinejs';
import { randomUUID } from 'node:crypto';
import * as haikuName from '../../../infra/haiku-name/index.js';

const INVALID_NEWLINE_REGEX = /\r|\n/;
export const isDeviceNameValid = (name: string) => {
	return !INVALID_NEWLINE_REGEX.test(name);
};

hooks.addPureHook('POST', 'resin', 'device', {
	POSTPARSE: async ({ request }) => {
		// Check for extra whitespace characters
		if (
			request.values.device_name != null &&
			!isDeviceNameValid(request.values.device_name)
		) {
			throw new errors.BadRequestError(
				'Device name cannot contain any newline characters.',
			);
		}

		request.values.device_name =
			request.values.device_name || haikuName.generate();
		request.values.uuid =
			request.values.uuid || randomUUID().replaceAll('-', '');

		if (!/^[a-f0-9]{32}([a-f0-9]{30})?$/.test(request.values.uuid)) {
			throw new errors.BadRequestError(
				'Device UUID must be a 32 or 62 character long lower case hex string.',
			);
		}
	},
});

hooks.addPureHook('PATCH', 'resin', 'device', {
	POSTPARSE: async ({ request }) => {
		// Check for extra whitespace characters
		if (
			request.values.device_name != null &&
			!isDeviceNameValid(request.values.device_name)
		) {
			throw new errors.BadRequestError(
				'Device name cannot contain any newline characters.',
			);
		}
		// Parse and set `os_variant` from `os_version` if not explicitly given
		if (
			request.values.os_version != null &&
			request.values.os_variant == null
		) {
			const match = /^.*\((.+)\)$/.exec(request.values.os_version);
			if (match != null) {
				request.values.os_variant = match[1];
			} else {
				request.values.os_variant = null;
			}
		}

		// When moving application make sure to set the build to null, unless a specific new
		// build has been targeted, instead of pointing to a build of the wrong application
		if (
			request.values.belongs_to__application != null &&
			request.values.is_pinned_on__release === undefined
		) {
			request.values.is_pinned_on__release = null;
		}

		if (request.values.is_connected_to_vpn != null) {
			request.values.is_online = request.values.is_connected_to_vpn;
			request.values.last_vpn_event = new Date();
		}

		if (request.values.is_online != null) {
			request.values.last_connectivity_event = new Date();
		}
	},
});

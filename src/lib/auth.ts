//
// Declares permissions assigned to default roles and API keys
//

import { sbvrUtils } from '../platform';
import { API_VPN_SERVICE_API_KEY, VPN_SERVICE_API_KEY } from './config';

const matchesActor = 'actor eq @__ACTOR_ID';
const ownsDevice = `owns__device/any(d:d/${matchesActor})`;
const belongsToApplicationOrIsManagedByDevice = `belongs_to__application/any(a:a/owns__device/any(d:d/${matchesActor} or d/is_managed_by__device/any(md:md/${matchesActor})))`;
const applicationControlsDevice = `application/any(a:a/${ownsDevice} or a/depends_on__application/any(da:da/${ownsDevice}))`;

export const ROLES: {
	[roleName: string]: string[];
} = {
	'provisioning-api-key': [
		`resin.device.create?belongs_to__application/any(a:a/${matchesActor})`,
	],
	'device-api-key': [
		`resin.device.get?${matchesActor}`,
		`resin.device.update?${matchesActor}`,
		`resin.supervisor_release.get?should_manage__device/any(d:d/${matchesActor})`,
		`resin.application.read?${ownsDevice} or depends_on__application/any(a:a/${ownsDevice})`,
		`resin.device_config_variable.get?device/any(d:d/${matchesActor} or d/belongs_to__application/any(a:a/depends_on__application/any(da:da/${ownsDevice})))`,
		`resin.device_config_variable.set?device/any(d:d/${matchesActor})`,
		`resin.device_tag.get?device/any(d:d/${matchesActor})`,
		`resin.device_tag.set?device/any(d:d/${matchesActor})`,
		`resin.application_config_variable.get?${applicationControlsDevice}`,
		`resin.release.read?should_be_running_on__device/any(d:d/${matchesActor})`,
		`resin.release.read?${belongsToApplicationOrIsManagedByDevice}`,
		`resin.device_environment_variable.get?device/any(d:d/${matchesActor} or d/belongs_to__application/any(a:a/depends_on__application/any(da:da/${ownsDevice})))`,
		`resin.application_environment_variable.get?${applicationControlsDevice}`,

		// Dependent device permissions
		`resin.device.create?belongs_to__application/any(da:da/depends_on__application/any(a:a/${ownsDevice}))`,
		`resin.device.read?belongs_to__application/any(da:da/depends_on__application/any(a:a/${ownsDevice}))`,
		`resin.device.update?belongs_to__application/any(da:da/depends_on__application/any(a:a/${ownsDevice}))`,

		`resin.service.get?${applicationControlsDevice}`,

		`resin.service_install.all?installs__service/any(s:s/${applicationControlsDevice})`,

		`resin.service_environment_variable.get?service/any(s:s/${applicationControlsDevice})`,

		`resin.device_service_environment_variable.get?service_install/any(si:si/installs__service/any(s:s/${applicationControlsDevice}))`,

		`resin.image__is_part_of__release.get?is_part_of__release/any(r:r/${belongsToApplicationOrIsManagedByDevice})`,

		`resin.image.get?image_install/any(ii:ii/device/any(d:d/${matchesActor} or d/is_managed_by__device/any(md:md/${matchesActor})))`,
		`resin.image.get?image__is_part_of__release/any(ipr:ipr/is_part_of__release/any(r:r/${belongsToApplicationOrIsManagedByDevice}))`,

		`resin.image_install.create?device/any(d:d/${matchesActor} or d/is_managed_by__device/any(md:md/${matchesActor})) and installs__image/any(i:i/image__is_part_of__release/any(ipr:ipr/is_part_of__release/any(r:r/belongs_to__application/any(a:a/${ownsDevice}))))`,
		`resin.image_install.read?device/any(d:d/${matchesActor} or d/is_managed_by__device/any(md:md/${matchesActor}))`,
		`resin.image_install.update?device/any(d:d/${matchesActor} or d/is_managed_by__device/any(md:md/${matchesActor}))`,

		`resin.image_label.get?release_image/any(ipr:ipr/is_part_of__release/any(r:r/${belongsToApplicationOrIsManagedByDevice}))`,

		`resin.service_label.all?service/any(s:s/${applicationControlsDevice})`,

		`resin.image_environment_variable.get?release_image/any(ipr:ipr/is_part_of__release/any(r:r/belongs_to__application/any(a:a/${ownsDevice})))`,

		// we can update the gateway if the image is part of an application which is depended on by the
		// application that the device belongs to
		//		OR
		//	the image belongs to an application which contains a device which is managed by the device
		//	doing the updating
		`resin.gateway_download.all?image/any(i:i/is_a_build_of__service/any(s:s/application/any(a:a/depends_on__application/any(da:da/${ownsDevice}) or a/owns__device/any(d:d/is_managed_by__device/any(md:md/${matchesActor})))))`,

		`resin.image.push?image__is_part_of__release/any(ipr:ipr/is_part_of__release/any(r:r/${belongsToApplicationOrIsManagedByDevice}))`,

		`resin.device.write-log?${matchesActor}`,
	],
	// also default-user (see below)
	'named-user-api-key': [
		'resin.actor.delete?id eq @__ACTOR_ID',
		'resin.api_key.read?is_of__actor eq @__ACTOR_ID',
		'resin.application.all',
		'resin.application_config_variable.all',
		'resin.application_environment_variable.all',
		'resin.application_type.all',
		'resin.device.all',
		'resin.device_config_variable.all',
		'resin.device_environment_variable.all',
		'resin.device_service_environment_variable.all',
		'resin.gateway_download.all',
		'resin.image.all',
		'resin.image__is_part_of__release.all',
		'resin.image_environment_variable.all',
		'resin.image_install.all',
		'resin.image_label.all',
		'resin.release.all',
		'resin.service.all',
		'resin.service_environment_variable.all',
		'resin.service_install.all',
		'resin.service_label.all',
		'resin.user.read',

		`resin.service_instance.get?service_type eq 'vpn'`,
		`resin.device.tunnel-22222?`,
	],
};

export const DEFAULT_USER_EXTRA_PERMISSIONS = [
	'auth.create_token',
	`resin.user.create-user-api-key?${matchesActor}`,
	`resin.user.create-named-user-api-key?${matchesActor}`,
	// api_key.create is not allowed, must be done via the custom endpoints
	'resin.api_key.update?is_of__actor eq @__ACTOR_ID',
	'resin.api_key.delete?is_of__actor eq @__ACTOR_ID',
];

ROLES['default-user'] = [
	...ROLES['named-user-api-key'],
	...DEFAULT_USER_EXTRA_PERMISSIONS,
];

export const KEYS: {
	[keyName: string]: {
		key?: string;
		permissions: string[];
	};
} = {
	'service.api': {
		key: API_VPN_SERVICE_API_KEY,
		permissions: ['resin.device.tunnel-48484'],
	},
	'service.vpn': {
		key: VPN_SERVICE_API_KEY,
		permissions: [
			'service',
			'service.vpn',
			'resin.device.read',
			'resin.device.update',
			'resin.service_instance.create',
			'resin.service_instance.update',
		],
	},
};

const SERVICE_PREFIX = 'service.';

export const getServiceFromRequest = (req: {
	apiKey?: sbvrUtils.ApiKey;
}): string | undefined => {
	if (req.apiKey == null || req.apiKey.permissions == null) {
		return;
	}
	return req.apiKey.permissions
		.filter(perm => perm.startsWith(SERVICE_PREFIX))
		.map(perm => perm.replace(SERVICE_PREFIX, ''))
		.shift();
};

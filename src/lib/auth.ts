//
// Declares permissions assigned to default roles and API keys
//

import { sbvrUtils } from '@balena/pinejs';
import type Model from '../balena-model.js';
import {
	API_VPN_SERVICE_API_KEY,
	IGNORE_FROZEN_DEVICE_PERMISSIONS,
	VPN_GUEST_API_KEY,
	VPN_SERVICE_API_KEY,
} from './config.js';
import { Filter } from 'pinejs-client-core';
const { api } = sbvrUtils;

const defaultWritePerms = ['create', 'update', 'delete'] as const;

const writePerms = (
	resource: string,
	filter: string,
	access: ReadonlyArray<(typeof defaultWritePerms)[number]> = defaultWritePerms,
): string[] => access.map((verb) => `${resource}.${verb}?${filter}`);

const compileAuth = <TResource extends string & keyof Model>(
	resource: TResource,
	access: string,
	$filter?: Filter<Model[TResource]['Read']>
) => {
	const options = $filter ? { $filter } : undefined;
	return api.resin.compileAuth({
		modelName: 'resin',
		resource,
		access,
		options
	});
};

const actorId = { '@': '__ACTOR_ID' } as const;
const matchesActorFilter = { actor: actorId } as const;

const matchesUserFilter = {
	user: {
		$any: {
			$alias: 'u',
			$expr: {
				u: matchesActorFilter,
			},
		},
	},
} as const;

const matchesActor = 'actor eq @__ACTOR_ID';
// const matchesUser = `user/any(u:u/${matchesActor})`;
const matchesNonFrozenDeviceActor = (alias = '') => {
	if (alias) {
		alias += '/';
	}
	const andIsNotFrozen = !IGNORE_FROZEN_DEVICE_PERMISSIONS
		? ` and ${alias}is_frozen eq false`
		: '';
	return `${alias}${matchesActor}${andIsNotFrozen}`;
};

const matchesNonFrozenDeviceActorFilter = IGNORE_FROZEN_DEVICE_PERMISSIONS ? {
	...matchesActorFilter,
	is_frozen: false,
} : matchesActorFilter;

const ownsDevice = `owns__device/any(d:d/${matchesActor})`;

export const ROLES: {
	[roleName: string]: string[];
} = {
	'provisioning-api-key': [
		`resin.device.create?belongs_to__application/any(a:a/${matchesActor})`,
	],
	// also default-user (see below)
	'named-user-api-key': [
		// 'resin.actor.delete?id eq @__ACTOR_ID',
		compileAuth('actor', 'delete', {
			id: {
				'@': '__ACTOR_ID',
			},
		}),

		// 'resin.api_key.read?is_of__actor eq @__ACTOR_ID',
		compileAuth('api_key', 'read', {
			is_of__actor: {
				'@': '__ACTOR_ID',
			},
		}),

		// 'resin.application.all',
		compileAuth('application', 'all'),

		// 'resin.device_type.read',
		compileAuth('device_type', 'read'),

		// 'resin.device_type_alias.read',
		compileAuth('device_type_alias', 'read'),

		// 'resin.cpu_architecture.read',
		compileAuth('cpu_architecture', 'read'),

		// 'resin.application_config_variable.all',
		compileAuth('application_config_variable', 'all'),

		// 'resin.application_environment_variable.all',
		compileAuth('application_environment_variable', 'all'),

		// 'resin.application_tag.all',
		compileAuth('application_tag', 'all'),

		// 'resin.application_type.all',
		compileAuth('application_type', 'all'),

		// 'resin.device.all',
		compileAuth('device', 'all'),

		// 'resin.device.tunnel-22222',
		compileAuth('device', 'tunnel-22222'),

		// 'resin.device_config_variable.all',
		compileAuth('device_config_variable', 'all'),

		// 'resin.device_environment_variable.all',
		compileAuth('device_environment_variable', 'all'),

		// 'resin.device_tag.all',
		compileAuth('device_tag', 'all'),

		// 'resin.device_service_environment_variable.all',
		compileAuth('device_service_environment_variable', 'all'),

		// 'resin.image.all',
		compileAuth('image', 'all'),

		// 'resin.image__is_part_of__release.all',
		compileAuth('image__is_part_of__release', 'all'),

		// 'resin.image_environment_variable.all',
		compileAuth('image_environment_variable', 'all'),

		// 'resin.image_install.all',
		compileAuth('image_install', 'all'),

		// 'resin.image_label.all',
		compileAuth('image_label', 'all'),

		// 'resin.organization.read',
		compileAuth('organization', 'read'),

		// 'resin.organization_membership.read',
		compileAuth('organization_membership', 'read'),

		// 'resin.release.all',
		compileAuth('release', 'all'),

		// 'resin.release_tag.all',
		compileAuth('release_tag', 'all'),

		// 'resin.service.all',
		compileAuth('service', 'all'),

		// 'resin.service_environment_variable.all',
		compileAuth('service_environment_variable', 'all'),

		// 'resin.service_install.all',
		compileAuth('service_install', 'all'),

		// "resin.service_instance.read?service_type eq 'vpn'",
		compileAuth('service_instance', 'read', { service_type: 'vpn' }),

		// 'resin.service_label.all',
		compileAuth('service_label', 'all'),

		// 'resin.user.read',
		compileAuth('user', 'read'),

		// `resin.user__has__public_key.all?${matchesUser}`,
		compileAuth('user__has__public_key', 'all', matchesUserFilter),

		// 'resin.release_asset.all',
		compileAuth('release_asset', 'all'),
	],
};

export const canAccess = {
	$fn: {
		$scope: 'Auth',
		$method: 'canAccess'
	}
} as const;

export const DEVICE_API_KEY_PERMISSIONS = [
	// 'resin.device_type.read?describes__device/canAccess()',
	compileAuth('device_type', 'read', { describes__device: canAccess }),

	// `resin.device.read?${matchesNonFrozenDeviceActorFilter()}`,
	// `resin.device.update?${matchesNonFrozenDeviceActorFilter()}`,

	// 'resin.application.read?owns__device/canAccess() or (is_public eq true and is_for__device_type/any(dt:dt/describes__device/canAccess()))',
	compileAuth('application', 'read', {
		$or: {
			owns__device: canAccess,
			$and: {
				is_public: true,
				is_for__device_type: {
					$any: {
						$alias: 'dt',
						$expr: {
							dt: {
								describes__device: canAccess,
							},
						},
					},
				},
			},
		}
	}),

	// 'resin.application_tag.read?application/canAccess()',
	compileAuth('application_tag', 'read', { application: canAccess }),

	// 'resin.device_config_variable.read?device/canAccess()',
	compileAuth('device_config_variable', 'read', { device: canAccess }),

	// `resin.device_config_variable.create?device/any(d:${matchesNonFrozenDeviceActor(
	// 	'd',
	// )})`,
	compileAuth('device_config_variable', 'create', {
		device: {
			$any: {
				$alias: 'd',
				$expr: {
					d: matchesNonFrozenDeviceActorFilter,
				}
			}
		}
	}),

	`resin.device_config_variable.update?device/any(d:${matchesNonFrozenDeviceActor(
		'd',
	)})`,
	`resin.device_tag.read?device/canAccess()`,
	...writePerms(
		'resin.device_tag',
		`device/any(d:${matchesNonFrozenDeviceActor('d')})`,
	),
	'resin.application_config_variable.read?application/canAccess()',
	'resin.release.read?is_pinned_to__device/canAccess() or belongs_to__application/canAccess()',
	'resin.release_tag.read?release/canAccess()',
	'resin.device_environment_variable.read?device/canAccess()',
	...writePerms(
		'resin.device_environment_variable',
		`device/any(d:${matchesNonFrozenDeviceActor('d')})`,
	),
	'resin.application_environment_variable.read?application/canAccess()',

	'resin.service.read?application/canAccess() or service_install/canAccess() or is_built_by__image/canAccess()',

	'resin.service_install.read?device/canAccess()',
	// Should be created for the device itself, and it should be for a service of the app that the device belongs to or for a service of the supervisor/hostApp release that manages/operates the device.
	`resin.service_install.create?device/any(d:${matchesNonFrozenDeviceActor(
		'd',
	)}) and installs__service/any(s:s/application/any(a:a/owns__device/any(d:d/${matchesActor}) or (a/is_public eq true and a/owns__release/any(r:r/should_manage__device/any(d:d/${matchesActor}) or r/should_operate__device/any(d:d/${matchesActor})))))`,
	// A device should be able to manage its own service installs, even from apps its not or no longer part of (past/supervisor/os)
	...writePerms(
		'resin.service_install',
		`device/any(d:${matchesNonFrozenDeviceActor('d')})`,
		['update', 'delete'],
	),

	'resin.service_environment_variable.read?service/canAccess()',

	'resin.device_service_environment_variable.read?service_install/canAccess()',
	...writePerms(
		'resin.device_service_environment_variable',
		`service_install/any(si:si/device/any(d:${matchesNonFrozenDeviceActor(
			'd',
		)}))`,
	),

	'resin.image__is_part_of__release.read?is_part_of__release/canAccess()',

	'resin.image.read?image_install/canAccess() or image__is_part_of__release/canAccess()',

	'resin.image_install.read?device/canAccess()',
	`resin.image_install.create?device/any(d:${matchesNonFrozenDeviceActor(
		'd',
	)}) and installs__image/any(i:i/image__is_part_of__release/any(ipr:ipr/is_part_of__release/any(r:r/belongs_to__application/any(a:a/${ownsDevice} or a/is_public eq true))))`,
	`resin.image_install.update?device/any(d:${matchesNonFrozenDeviceActor(
		'd',
	)})`,

	'resin.image_label.read?release_image/canAccess()',

	'resin.service_label.read?service/canAccess()',

	'resin.image_environment_variable.read?release_image/canAccess()',

	`resin.device.cloudlink?${matchesActor}`,
	`resin.device.write-log?${matchesNonFrozenDeviceActor()}`,
];

ROLES['device-api-key'] = [
	...DEVICE_API_KEY_PERMISSIONS,
	'resin.user__has__public_key.read',
];

export const DEFAULT_USER_EXTRA_PERMISSIONS = [
	'auth.create_token',
	'auth.credentials_login',
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
		permissions: ['service.api', 'resin.device.tunnel-48484'],
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

if (VPN_GUEST_API_KEY != null) {
	KEYS['service.vpn-guest'] = {
		key: VPN_GUEST_API_KEY,
		permissions: ['service', 'service.vpn-guest'],
	};
}

const SERVICE_PREFIX = 'service.';

export const getServiceFromRequest = (req: {
	apiKey?: sbvrUtils.ApiKey;
}): string | undefined => {
	if (req.apiKey?.permissions == null) {
		return;
	}
	const servicePerm = req.apiKey.permissions.find((perm) =>
		perm.startsWith(SERVICE_PREFIX),
	);
	if (servicePerm) {
		return servicePerm.replace(SERVICE_PREFIX, '');
	}
};

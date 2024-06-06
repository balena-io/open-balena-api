/**
 * This file is auto-generated with `npm run generate-model-types`
 */

import type { Types } from '@balena/abstract-sql-to-typescript';

export interface Actor {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		is_of__user?: Array<User['Read']>;
		is_of__application?: Array<Application['Read']>;
		is_of__device?: Array<Device['Read']>;
		api_key?: Array<ApiKey['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
	};
}

export interface Permission {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		name: Types['Short Text']['Read'];
		is_of__role?: Array<RoleHasPermission['Read']>;
		is_of__user?: Array<UserHasPermission['Read']>;
		is_of__api_key?: Array<ApiKeyHasPermission['Read']>;
		user__has__permission?: Array<UserHasPermission['Read']>;
		user_permission?: Array<UserHasPermission['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		name: Types['Short Text']['Write'];
	};
}

export interface Role {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		name: Types['Short Text']['Read'];
		role__has__permission?: Array<RoleHasPermission['Read']>;
		user__has__role?: Array<UserHasRole['Read']>;
		user_role?: Array<UserHasRole['Read']>;
		is_of__user?: Array<UserHasRole['Read']>;
		is_of__api_key?: Array<ApiKeyHasRole['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		name: Types['Short Text']['Write'];
	};
}

export interface RoleHasPermission {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		role: { __id: Role['Read']['id'] } | [Role['Read']];
		permission: { __id: Permission['Read']['id'] } | [Permission['Read']];
		id: Types['Serial']['Read'];
		is_of__role: { __id: Role['Read']['id'] } | [Role['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		role: Role['Write']['id'];
		permission: Permission['Write']['id'];
		id: Types['Serial']['Write'];
	};
}

export interface User {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		actor: { __id: Actor['Read']['id'] } | [Actor['Read']];
		username: Types['Short Text']['Read'];
		password: Types['Hashed']['Read'] | null;
		jwt_secret: Types['Short Text']['Read'] | null;
		email: Types['Text']['Read'] | null;
		user__has__role?: Array<UserHasRole['Read']>;
		user_role?: Array<UserHasRole['Read']>;
		user__has__permission?: Array<UserHasPermission['Read']>;
		user_permission?: Array<UserHasPermission['Read']>;
		user__has__public_key?: Array<UserHasPublicKey['Read']>;
		user_public_key?: Array<UserHasPublicKey['Read']>;
		user__is_member_of__organization?: Array<OrganizationMembership['Read']>;
		organization_membership?: Array<OrganizationMembership['Read']>;
		is_member_of__organization?: Array<OrganizationMembership['Read']>;
		has_direct_access_to__application?: Array<
			UserHasDirectAccessToApplication['Read']
		>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		actor: Actor['Write']['id'];
		username: Types['Short Text']['Write'];
		password: Types['Hashed']['Write'] | null;
		jwt_secret: Types['Short Text']['Write'] | null;
		email: Types['Text']['Write'] | null;
	};
}

export interface UserHasRole {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		user: { __id: User['Read']['id'] } | [User['Read']];
		role: { __id: Role['Read']['id'] } | [Role['Read']];
		id: Types['Serial']['Read'];
		expiry_date: Types['Date Time']['Read'] | null;
		is_of__user: { __id: User['Read']['id'] } | [User['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		user: User['Write']['id'];
		role: Role['Write']['id'];
		id: Types['Serial']['Write'];
		expiry_date: Types['Date Time']['Write'] | null;
	};
}

export interface UserHasPermission {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		user: { __id: User['Read']['id'] } | [User['Read']];
		permission: { __id: Permission['Read']['id'] } | [Permission['Read']];
		id: Types['Serial']['Read'];
		expiry_date: Types['Date Time']['Read'] | null;
		is_of__user: { __id: User['Read']['id'] } | [User['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		user: User['Write']['id'];
		permission: Permission['Write']['id'];
		id: Types['Serial']['Write'];
		expiry_date: Types['Date Time']['Write'] | null;
	};
}

export interface ApiKey {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		key: Types['Short Text']['Read'];
		expiry_date: Types['Date Time']['Read'] | null;
		is_of__actor: { __id: Actor['Read']['id'] } | [Actor['Read']];
		name: Types['Short Text']['Read'] | null;
		description: Types['Text']['Read'] | null;
		api_key__has__role?: Array<ApiKeyHasRole['Read']>;
		api_key__has__permission?: Array<ApiKeyHasPermission['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		key: Types['Short Text']['Write'];
		expiry_date: Types['Date Time']['Write'] | null;
		is_of__actor: Actor['Write']['id'];
		name: Types['Short Text']['Write'] | null;
		description: Types['Text']['Write'] | null;
	};
}

export interface ApiKeyHasRole {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		api_key: { __id: ApiKey['Read']['id'] } | [ApiKey['Read']];
		role: { __id: Role['Read']['id'] } | [Role['Read']];
		id: Types['Serial']['Read'];
		is_of__api_key: { __id: ApiKey['Read']['id'] } | [ApiKey['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		api_key: ApiKey['Write']['id'];
		role: Role['Write']['id'];
		id: Types['Serial']['Write'];
	};
}

export interface ApiKeyHasPermission {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		api_key: { __id: ApiKey['Read']['id'] } | [ApiKey['Read']];
		permission: { __id: Permission['Read']['id'] } | [Permission['Read']];
		id: Types['Serial']['Read'];
		is_of__api_key: { __id: ApiKey['Read']['id'] } | [ApiKey['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		api_key: ApiKey['Write']['id'];
		permission: Permission['Write']['id'];
		id: Types['Serial']['Write'];
	};
}

export interface ApplicationType {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		name: Types['Short Text']['Read'];
		supports_web_url: Types['Boolean']['Read'];
		supports_multicontainer: Types['Boolean']['Read'];
		supports_gateway_mode: Types['Boolean']['Read'];
		needs__os_version_range: Types['Short Text']['Read'] | null;
		requires_payment: Types['Boolean']['Read'];
		is_legacy: Types['Boolean']['Read'];
		slug: Types['Short Text']['Read'];
		description: Types['Text']['Read'] | null;
		maximum_device_count: Types['Integer']['Read'] | null;
		is_of__application?: Array<Application['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		name: Types['Short Text']['Write'];
		supports_web_url: Types['Boolean']['Write'];
		supports_multicontainer: Types['Boolean']['Write'];
		supports_gateway_mode: Types['Boolean']['Write'];
		needs__os_version_range: Types['Short Text']['Write'] | null;
		requires_payment: Types['Boolean']['Write'];
		is_legacy: Types['Boolean']['Write'];
		slug: Types['Short Text']['Write'];
		description: Types['Text']['Write'] | null;
		maximum_device_count: Types['Integer']['Write'] | null;
	};
}

export interface Config {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		key: Types['Short Text']['Read'];
		value: Types['Text']['Read'];
		scope: Types['Short Text']['Read'] | null;
		description: Types['Text']['Read'] | null;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		key: Types['Short Text']['Write'];
		value: Types['Text']['Write'];
		scope: Types['Short Text']['Write'] | null;
		description: Types['Text']['Write'] | null;
	};
}

export interface CpuArchitecture {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		slug: Types['Short Text']['Read'];
		is_supported_by__device_type?: Array<DeviceType['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		slug: Types['Short Text']['Write'];
	};
}

export interface DeviceFamily {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		slug: Types['Short Text']['Read'];
		name: Types['Short Text']['Read'];
		is_manufactured_by__device_manufacturer:
			| { __id: DeviceManufacturer['Read']['id'] }
			| [DeviceManufacturer['Read']]
			| []
			| null;
		device_type?: Array<DeviceType['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		slug: Types['Short Text']['Write'];
		name: Types['Short Text']['Write'];
		is_manufactured_by__device_manufacturer:
			| DeviceManufacturer['Write']['id']
			| null;
	};
}

export interface DeviceManufacturer {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		slug: Types['Short Text']['Read'];
		name: Types['Short Text']['Read'];
		manufactures__device_family?: Array<DeviceFamily['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		slug: Types['Short Text']['Write'];
		name: Types['Short Text']['Write'];
	};
}

export interface DeviceType {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		slug: Types['Short Text']['Read'];
		name: Types['Short Text']['Read'];
		is_of__cpu_architecture:
			| { __id: CpuArchitecture['Read']['id'] }
			| [CpuArchitecture['Read']];
		logo: Types['Text']['Read'] | null;
		contract: Types['JSON']['Read'] | null;
		belongs_to__device_family:
			| { __id: DeviceFamily['Read']['id'] }
			| [DeviceFamily['Read']]
			| []
			| null;
		is_default_for__application?: Array<Application['Read']>;
		describes__device?: Array<Device['Read']>;
		device_type__is_referenced_by__alias?: Array<DeviceTypeAlias['Read']>;
		device_type_alias?: Array<DeviceTypeAlias['Read']>;
		is_referenced_by__alias?: Array<DeviceTypeAlias['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		slug: Types['Short Text']['Write'];
		name: Types['Short Text']['Write'];
		is_of__cpu_architecture: CpuArchitecture['Write']['id'];
		logo: Types['Text']['Write'] | null;
		contract: Types['JSON']['Write'] | null;
		belongs_to__device_family: DeviceFamily['Write']['id'] | null;
	};
}

export interface Image {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		start_timestamp: Types['Date Time']['Read'];
		end_timestamp: Types['Date Time']['Read'] | null;
		dockerfile: Types['Text']['Read'] | null;
		is_a_build_of__service: { __id: Service['Read']['id'] } | [Service['Read']];
		image_size: Types['Big Integer']['Read'] | null;
		is_stored_at__image_location: Types['Short Text']['Read'];
		project_type: Types['Short Text']['Read'] | null;
		error_message: Types['Text']['Read'] | null;
		build_log: Types['Text']['Read'] | null;
		push_timestamp: Types['Date Time']['Read'] | null;
		status: Types['Short Text']['Read'];
		content_hash: Types['Short Text']['Read'] | null;
		contract: Types['JSON']['Read'] | null;
		device__installs__image?: Array<ImageInstall['Read']>;
		image_install?: Array<ImageInstall['Read']>;
		is_installed_on__device?: Array<ImageInstall['Read']>;
		is_part_of__release?: Array<ImageIsPartOfRelease['Read']>;
		image__is_part_of__release?: Array<ImageIsPartOfRelease['Read']>;
		release_image?: Array<ImageIsPartOfRelease['Read']>;
		is_a_build_of__application__has__service_name:
			| { __id: Service['Read']['id'] }
			| [Service['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		start_timestamp: Types['Date Time']['Write'];
		end_timestamp: Types['Date Time']['Write'] | null;
		dockerfile: Types['Text']['Write'] | null;
		is_a_build_of__service: Service['Write']['id'];
		image_size: Types['Big Integer']['Write'] | null;
		is_stored_at__image_location: Types['Short Text']['Write'];
		project_type: Types['Short Text']['Write'] | null;
		error_message: Types['Text']['Write'] | null;
		build_log: Types['Text']['Write'] | null;
		push_timestamp: Types['Date Time']['Write'] | null;
		status: Types['Short Text']['Write'];
		content_hash: Types['Short Text']['Write'] | null;
		contract: Types['JSON']['Write'] | null;
	};
}

export interface Organization {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		name: Types['Short Text']['Read'];
		handle: Types['Short Text']['Read'];
		user__is_member_of__organization?: Array<OrganizationMembership['Read']>;
		organization_membership?: Array<OrganizationMembership['Read']>;
		includes__user?: Array<OrganizationMembership['Read']>;
		application?: Array<Application['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		name: Types['Short Text']['Write'];
		handle: Types['Short Text']['Write'];
	};
}

export interface ScheduledJobRun {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		name: Types['Short Text']['Read'];
		start_timestamp: Types['Date Time']['Read'];
		end_timestamp: Types['Date Time']['Read'] | null;
		status: 'running' | 'success' | 'error';
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		name: Types['Short Text']['Write'];
		start_timestamp: Types['Date Time']['Write'];
		end_timestamp: Types['Date Time']['Write'] | null;
		status: 'running' | 'success' | 'error';
	};
}

export interface ServiceInstance {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		service_type: Types['Short Text']['Read'];
		ip_address: Types['Short Text']['Read'];
		last_heartbeat: Types['Date Time']['Read'];
		manages__device?: Array<Device['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		service_type: Types['Short Text']['Write'];
		ip_address: Types['Short Text']['Write'];
		last_heartbeat: Types['Date Time']['Write'];
	};
}

export interface Application {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		actor: { __id: Actor['Read']['id'] } | [Actor['Read']];
		should_track_latest_release: Types['Boolean']['Read'];
		is_of__class: 'fleet' | 'block' | 'app';
		organization: { __id: Organization['Read']['id'] } | [Organization['Read']];
		app_name: Types['Text']['Read'];
		slug: Types['Short Text']['Read'];
		is_for__device_type:
			| { __id: DeviceType['Read']['id'] }
			| [DeviceType['Read']];
		should_be_running__release:
			| { __id: Release['Read']['id'] }
			| [Release['Read']]
			| []
			| null;
		application_type:
			| { __id: ApplicationType['Read']['id'] }
			| [ApplicationType['Read']];
		is_host: Types['Boolean']['Read'];
		is_archived: Types['Boolean']['Read'];
		uuid: Types['Text']['Read'];
		is_public: Types['Boolean']['Read'];
		application__has__env_var_name?: Array<
			ApplicationEnvironmentVariable['Read']
		>;
		application_environment_variable?: Array<
			ApplicationEnvironmentVariable['Read']
		>;
		application__has__config_var_name?: Array<
			ApplicationConfigVariable['Read']
		>;
		application_config_variable?: Array<ApplicationConfigVariable['Read']>;
		application__has__service_name?: Array<Service['Read']>;
		service?: Array<Service['Read']>;
		application__has__tag_key?: Array<ApplicationTag['Read']>;
		application_tag?: Array<ApplicationTag['Read']>;
		owns__device?: Array<Device['Read']>;
		owns__release?: Array<Release['Read']>;
		is_directly_accessible_by__user?: Array<
			UserHasDirectAccessToApplication['Read']
		>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		actor: Actor['Write']['id'];
		should_track_latest_release: Types['Boolean']['Write'];
		is_of__class: 'fleet' | 'block' | 'app';
		organization: Organization['Write']['id'];
		app_name: Types['Text']['Write'];
		slug: Types['Short Text']['Write'];
		is_for__device_type: DeviceType['Write']['id'];
		should_be_running__release: Release['Write']['id'] | null;
		application_type: ApplicationType['Write']['id'];
		is_host: Types['Boolean']['Write'];
		is_archived: Types['Boolean']['Write'];
		uuid: Types['Text']['Write'];
		is_public: Types['Boolean']['Write'];
	};
}

export interface ApplicationEnvironmentVariable {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		application: { __id: Application['Read']['id'] } | [Application['Read']];
		name: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		application: Application['Write']['id'];
		name: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface ApplicationConfigVariable {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		application: { __id: Application['Read']['id'] } | [Application['Read']];
		name: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		application: Application['Write']['id'];
		name: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface Service {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		application: { __id: Application['Read']['id'] } | [Application['Read']];
		service_name: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		application__has__service_name__has__label_name?: Array<
			ServiceLabel['Read']
		>;
		service_label?: Array<ServiceLabel['Read']>;
		application__has__service_name__has__name?: Array<
			ServiceEnvironmentVariable['Read']
		>;
		service_environment_variable?: Array<ServiceEnvironmentVariable['Read']>;
		device__installs__application__has__service_name?: Array<
			ServiceInstall['Read']
		>;
		service_install?: Array<ServiceInstall['Read']>;
		is_installed_on__device?: Array<ServiceInstall['Read']>;
		is_built_by__image?: Array<Image['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		application: Application['Write']['id'];
		service_name: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
	};
}

export interface ServiceLabel {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		service: { __id: Service['Read']['id'] } | [Service['Read']];
		label_name: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
		application__has__service_name:
			| { __id: Service['Read']['id'] }
			| [Service['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		service: Service['Write']['id'];
		label_name: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface ServiceEnvironmentVariable {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		service: { __id: Service['Read']['id'] } | [Service['Read']];
		name: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
		application__has__service_name:
			| { __id: Service['Read']['id'] }
			| [Service['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		service: Service['Write']['id'];
		name: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface ApplicationTag {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		application: { __id: Application['Read']['id'] } | [Application['Read']];
		tag_key: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		application: Application['Write']['id'];
		tag_key: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface Device {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		actor: { __id: Actor['Read']['id'] } | [Actor['Read']];
		api_heartbeat_state: 'online' | 'offline' | 'timeout' | 'unknown';
		uuid: Types['Text']['Read'];
		local_id: Types['Short Text']['Read'] | null;
		device_name: Types['Short Text']['Read'] | null;
		note: Types['Text']['Read'] | null;
		is_of__device_type:
			| { __id: DeviceType['Read']['id'] }
			| [DeviceType['Read']];
		belongs_to__application:
			| { __id: Application['Read']['id'] }
			| [Application['Read']]
			| []
			| null;
		is_online: Types['Boolean']['Read'];
		last_connectivity_event: Types['Date Time']['Read'] | null;
		is_connected_to_vpn: Types['Boolean']['Read'];
		last_vpn_event: Types['Date Time']['Read'] | null;
		is_locked_until__date: Types['Date Time']['Read'] | null;
		public_address: Types['Short Text']['Read'] | null;
		ip_address: Types['Short Text']['Read'] | null;
		mac_address: Types['Short Text']['Read'] | null;
		memory_usage: Types['Integer']['Read'] | null;
		memory_total: Types['Integer']['Read'] | null;
		storage_block_device: Types['Short Text']['Read'] | null;
		storage_usage: Types['Integer']['Read'] | null;
		storage_total: Types['Integer']['Read'] | null;
		cpu_usage: Types['Integer']['Read'] | null;
		cpu_temp: Types['Integer']['Read'] | null;
		is_undervolted: Types['Boolean']['Read'];
		cpu_id: Types['Short Text']['Read'] | null;
		is_running__release:
			| { __id: Release['Read']['id'] }
			| [Release['Read']]
			| []
			| null;
		download_progress: Types['Integer']['Read'] | null;
		status: Types['Short Text']['Read'] | null;
		os_version: Types['Short Text']['Read'] | null;
		os_variant: Types['Short Text']['Read'] | null;
		supervisor_version: Types['Short Text']['Read'] | null;
		provisioning_progress: Types['Integer']['Read'] | null;
		provisioning_state: Types['Short Text']['Read'] | null;
		api_port: Types['Integer']['Read'] | null;
		api_secret: Types['Short Text']['Read'] | null;
		is_managed_by__service_instance:
			| { __id: ServiceInstance['Read']['id'] }
			| [ServiceInstance['Read']]
			| []
			| null;
		should_be_running__release:
			| { __id: Release['Read']['id'] }
			| [Release['Read']]
			| []
			| null;
		is_pinned_on__release:
			| { __id: Release['Read']['id'] }
			| [Release['Read']]
			| []
			| null;
		should_be_operated_by__release:
			| { __id: Release['Read']['id'] }
			| [Release['Read']]
			| []
			| null;
		should_be_managed_by__release:
			| { __id: Release['Read']['id'] }
			| [Release['Read']]
			| []
			| null;
		is_web_accessible: Types['Boolean']['Read'] | null;
		is_frozen: Types['Boolean']['Read'] | null;
		overall_status: Types['Short Text']['Read'] | null;
		overall_progress: Types['Integer']['Read'] | null;
		device__has__env_var_name?: Array<DeviceEnvironmentVariable['Read']>;
		device_environment_variable?: Array<DeviceEnvironmentVariable['Read']>;
		device__has__config_var_name?: Array<DeviceConfigVariable['Read']>;
		device_config_variable?: Array<DeviceConfigVariable['Read']>;
		device__has__tag_key?: Array<DeviceTag['Read']>;
		device_tag?: Array<DeviceTag['Read']>;
		device__installs__image?: Array<ImageInstall['Read']>;
		image_install?: Array<ImageInstall['Read']>;
		device__installs__application__has__service_name?: Array<
			ServiceInstall['Read']
		>;
		service_install?: Array<ServiceInstall['Read']>;
		installs__image?: Array<ImageInstall['Read']>;
		installs__application__has__service_name?: Array<ServiceInstall['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		actor: Actor['Write']['id'];
		api_heartbeat_state: 'online' | 'offline' | 'timeout' | 'unknown';
		uuid: Types['Text']['Write'];
		local_id: Types['Short Text']['Write'] | null;
		device_name: Types['Short Text']['Write'] | null;
		note: Types['Text']['Write'] | null;
		is_of__device_type: DeviceType['Write']['id'];
		belongs_to__application: Application['Write']['id'] | null;
		is_online: Types['Boolean']['Write'];
		last_connectivity_event: Types['Date Time']['Write'] | null;
		is_connected_to_vpn: Types['Boolean']['Write'];
		last_vpn_event: Types['Date Time']['Write'] | null;
		is_locked_until__date: Types['Date Time']['Write'] | null;
		public_address: Types['Short Text']['Write'] | null;
		ip_address: Types['Short Text']['Write'] | null;
		mac_address: Types['Short Text']['Write'] | null;
		memory_usage: Types['Integer']['Write'] | null;
		memory_total: Types['Integer']['Write'] | null;
		storage_block_device: Types['Short Text']['Write'] | null;
		storage_usage: Types['Integer']['Write'] | null;
		storage_total: Types['Integer']['Write'] | null;
		cpu_usage: Types['Integer']['Write'] | null;
		cpu_temp: Types['Integer']['Write'] | null;
		is_undervolted: Types['Boolean']['Write'];
		cpu_id: Types['Short Text']['Write'] | null;
		is_running__release: Release['Write']['id'] | null;
		download_progress: Types['Integer']['Write'] | null;
		status: Types['Short Text']['Write'] | null;
		os_version: Types['Short Text']['Write'] | null;
		os_variant: Types['Short Text']['Write'] | null;
		supervisor_version: Types['Short Text']['Write'] | null;
		provisioning_progress: Types['Integer']['Write'] | null;
		provisioning_state: Types['Short Text']['Write'] | null;
		api_port: Types['Integer']['Write'] | null;
		api_secret: Types['Short Text']['Write'] | null;
		is_managed_by__service_instance: ServiceInstance['Write']['id'] | null;
		should_be_running__release: Release['Write']['id'] | null;
		is_pinned_on__release: Release['Write']['id'] | null;
		should_be_operated_by__release: Release['Write']['id'] | null;
		should_be_managed_by__release: Release['Write']['id'] | null;
		is_web_accessible: Types['Boolean']['Write'] | null;
		is_frozen: Types['Boolean']['Write'] | null;
		overall_status: Types['Short Text']['Write'] | null;
		overall_progress: Types['Integer']['Write'] | null;
	};
}

export interface DeviceEnvironmentVariable {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		device: { __id: Device['Read']['id'] } | [Device['Read']];
		name: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		device: Device['Write']['id'];
		name: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface DeviceConfigVariable {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		device: { __id: Device['Read']['id'] } | [Device['Read']];
		name: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		device: Device['Write']['id'];
		name: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface ImageInstall {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		device: { __id: Device['Read']['id'] } | [Device['Read']];
		installs__image: { __id: Image['Read']['id'] } | [Image['Read']];
		id: Types['Serial']['Read'];
		install_date: Types['Date Time']['Read'];
		download_progress: Types['Integer']['Read'] | null;
		status: Types['Short Text']['Read'];
		is_provided_by__release:
			| { __id: Release['Read']['id'] }
			| [Release['Read']];
		image: { __id: Image['Read']['id'] } | [Image['Read']];
		is_installed_on__device: { __id: Device['Read']['id'] } | [Device['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		device: Device['Write']['id'];
		installs__image: Image['Write']['id'];
		id: Types['Serial']['Write'];
		install_date: Types['Date Time']['Write'];
		download_progress: Types['Integer']['Write'] | null;
		status: Types['Short Text']['Write'];
		is_provided_by__release: Release['Write']['id'];
	};
}

export interface ServiceInstall {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		device: { __id: Device['Read']['id'] } | [Device['Read']];
		installs__service: { __id: Service['Read']['id'] } | [Service['Read']];
		id: Types['Serial']['Read'];
		device__installs__application__has__service_name__has__name?: Array<
			DeviceServiceEnvironmentVariable['Read']
		>;
		device_service_environment_variable?: Array<
			DeviceServiceEnvironmentVariable['Read']
		>;
		application__has__service_name:
			| { __id: Service['Read']['id'] }
			| [Service['Read']];
		service: { __id: Service['Read']['id'] } | [Service['Read']];
		installs__application__has__service_name:
			| { __id: Service['Read']['id'] }
			| [Service['Read']];
		is_installed_on__device: { __id: Device['Read']['id'] } | [Device['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		device: Device['Write']['id'];
		installs__service: Service['Write']['id'];
		id: Types['Serial']['Write'];
	};
}

export interface DeviceServiceEnvironmentVariable {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		service_install:
			| { __id: ServiceInstall['Read']['id'] }
			| [ServiceInstall['Read']];
		name: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
		device__installs__application__has__service_name:
			| { __id: ServiceInstall['Read']['id'] }
			| [ServiceInstall['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		service_install: ServiceInstall['Write']['id'];
		name: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface DeviceTag {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		device: { __id: Device['Read']['id'] } | [Device['Read']];
		tag_key: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		device: Device['Write']['id'];
		tag_key: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface Release {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		belongs_to__application:
			| { __id: Application['Read']['id'] }
			| [Application['Read']];
		commit: Types['Short Text']['Read'];
		composition: Types['JSON']['Read'];
		status: Types['Short Text']['Read'];
		source: Types['Short Text']['Read'];
		build_log: Types['Text']['Read'] | null;
		is_invalidated: Types['Boolean']['Read'];
		start_timestamp: Types['Date Time']['Read'];
		end_timestamp: Types['Date Time']['Read'] | null;
		update_timestamp: Types['Date Time']['Read'];
		release_version: Types['Short Text']['Read'] | null;
		contract: Types['JSON']['Read'] | null;
		is_passing_tests: Types['Boolean']['Read'];
		is_finalized_at__date: Types['Date Time']['Read'] | null;
		phase: 'next' | 'current' | 'sunset' | 'end-of-life' | null;
		semver_major: Types['Integer']['Read'];
		semver_minor: Types['Integer']['Read'];
		semver_patch: Types['Integer']['Read'];
		semver_prerelease: Types['Short Text']['Read'];
		semver_build: Types['Short Text']['Read'];
		variant: Types['Short Text']['Read'];
		revision: Types['Integer']['Read'] | null;
		known_issue_list: Types['Text']['Read'] | null;
		note: Types['Text']['Read'] | null;
		invalidation_reason: Types['Text']['Read'] | null;
		is_final: Types['Boolean']['Read'];
		semver: Types['Short Text']['Read'];
		raw_version: Types['Short Text']['Read'];
		version: Types['JSON']['Read'];
		release__has__tag_key?: Array<ReleaseTag['Read']>;
		release_tag?: Array<ReleaseTag['Read']>;
		release__has__asset_key?: Array<ReleaseAsset['Read']>;
		release_asset?: Array<ReleaseAsset['Read']>;
		image__is_part_of__release?: Array<ImageIsPartOfRelease['Read']>;
		release_image?: Array<ImageIsPartOfRelease['Read']>;
		contains__image?: Array<ImageIsPartOfRelease['Read']>;
		should_be_running_on__application?: Array<Application['Read']>;
		should_be_running_on__device?: Array<Device['Read']>;
		is_running_on__device?: Array<Device['Read']>;
		is_pinned_to__device?: Array<Device['Read']>;
		should_operate__device?: Array<Device['Read']>;
		should_manage__device?: Array<Device['Read']>;
		provides__device__installs__image?: Array<ImageInstall['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		belongs_to__application: Application['Write']['id'];
		commit: Types['Short Text']['Write'];
		composition: Types['JSON']['Write'];
		status: Types['Short Text']['Write'];
		source: Types['Short Text']['Write'];
		build_log: Types['Text']['Write'] | null;
		is_invalidated: Types['Boolean']['Write'];
		start_timestamp: Types['Date Time']['Write'];
		end_timestamp: Types['Date Time']['Write'] | null;
		update_timestamp: Types['Date Time']['Write'];
		release_version: Types['Short Text']['Write'] | null;
		contract: Types['JSON']['Write'] | null;
		is_passing_tests: Types['Boolean']['Write'];
		is_finalized_at__date: Types['Date Time']['Write'] | null;
		phase: 'next' | 'current' | 'sunset' | 'end-of-life' | null;
		semver_major: Types['Integer']['Write'];
		semver_minor: Types['Integer']['Write'];
		semver_patch: Types['Integer']['Write'];
		semver_prerelease: Types['Short Text']['Write'];
		semver_build: Types['Short Text']['Write'];
		variant: Types['Short Text']['Write'];
		revision: Types['Integer']['Write'] | null;
		known_issue_list: Types['Text']['Write'] | null;
		note: Types['Text']['Write'] | null;
		invalidation_reason: Types['Text']['Write'] | null;
		is_final: Types['Boolean']['Write'];
		semver: Types['Short Text']['Write'];
		raw_version: Types['Short Text']['Write'];
		version: Types['JSON']['Write'];
	};
}

export interface ReleaseTag {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		release: { __id: Release['Read']['id'] } | [Release['Read']];
		tag_key: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		release: Release['Write']['id'];
		tag_key: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface ImageIsPartOfRelease {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		image: { __id: Image['Read']['id'] } | [Image['Read']];
		is_part_of__release: { __id: Release['Read']['id'] } | [Release['Read']];
		id: Types['Serial']['Read'];
		image__is_part_of__release__has__label_name?: Array<ImageLabel['Read']>;
		image_label?: Array<ImageLabel['Read']>;
		image__is_part_of__release__has__name?: Array<
			ImageEnvironmentVariable['Read']
		>;
		image_environment_variable?: Array<ImageEnvironmentVariable['Read']>;
		release: { __id: Release['Read']['id'] } | [Release['Read']];
		contains__image: { __id: Image['Read']['id'] } | [Image['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		image: Image['Write']['id'];
		is_part_of__release: Release['Write']['id'];
		id: Types['Serial']['Write'];
	};
}

export interface ImageLabel {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		release_image:
			| { __id: ImageIsPartOfRelease['Read']['id'] }
			| [ImageIsPartOfRelease['Read']];
		label_name: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
		image__is_part_of__release:
			| { __id: ImageIsPartOfRelease['Read']['id'] }
			| [ImageIsPartOfRelease['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		release_image: ImageIsPartOfRelease['Write']['id'];
		label_name: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface ImageEnvironmentVariable {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		release_image:
			| { __id: ImageIsPartOfRelease['Read']['id'] }
			| [ImageIsPartOfRelease['Read']];
		name: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		value: Types['Text']['Read'];
		image__is_part_of__release:
			| { __id: ImageIsPartOfRelease['Read']['id'] }
			| [ImageIsPartOfRelease['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		release_image: ImageIsPartOfRelease['Write']['id'];
		name: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		value: Types['Text']['Write'];
	};
}

export interface OrganizationMembership {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		user: { __id: User['Read']['id'] } | [User['Read']];
		is_member_of__organization:
			| { __id: Organization['Read']['id'] }
			| [Organization['Read']];
		id: Types['Serial']['Read'];
		organization: { __id: Organization['Read']['id'] } | [Organization['Read']];
		includes__user: { __id: User['Read']['id'] } | [User['Read']];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		user: User['Write']['id'];
		is_member_of__organization: Organization['Write']['id'];
		id: Types['Serial']['Write'];
	};
}

export interface UserHasPublicKey {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		user: { __id: User['Read']['id'] } | [User['Read']];
		public_key: Types['Text']['Read'];
		id: Types['Serial']['Read'];
		title: Types['Short Text']['Read'];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		user: User['Write']['id'];
		public_key: Types['Text']['Write'];
		id: Types['Serial']['Write'];
		title: Types['Short Text']['Write'];
	};
}

export interface DeviceTypeAlias {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		device_type: { __id: DeviceType['Read']['id'] } | [DeviceType['Read']];
		is_referenced_by__alias: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		device_type: DeviceType['Write']['id'];
		is_referenced_by__alias: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
	};
}

export interface ReleaseAsset {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		release: { __id: Release['Read']['id'] } | [Release['Read']];
		asset_key: Types['Short Text']['Read'];
		id: Types['Serial']['Read'];
		asset: Types['WebResource']['Read'];
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		release: Release['Write']['id'];
		asset_key: Types['Short Text']['Write'];
		id: Types['Serial']['Write'];
		asset: Types['WebResource']['Write'];
	};
}

export interface MyApplication {
	Read: {
		created_at: Types['Date Time']['Read'];
		modified_at: Types['Date Time']['Read'];
		id: Types['Serial']['Read'];
		actor: { __id: Actor['Read']['id'] } | [Actor['Read']];
		should_track_latest_release: Types['Boolean']['Read'];
		is_of__class: 'fleet' | 'block' | 'app';
		organization: { __id: Organization['Read']['id'] } | [Organization['Read']];
		app_name: Types['Text']['Read'];
		slug: Types['Short Text']['Read'];
		is_for__device_type:
			| { __id: DeviceType['Read']['id'] }
			| [DeviceType['Read']];
		should_be_running__release:
			| { __id: Release['Read']['id'] }
			| [Release['Read']]
			| []
			| null;
		application_type:
			| { __id: ApplicationType['Read']['id'] }
			| [ApplicationType['Read']];
		is_host: Types['Boolean']['Read'];
		is_archived: Types['Boolean']['Read'];
		uuid: Types['Text']['Read'];
		is_public: Types['Boolean']['Read'];
		application__has__env_var_name?: Array<
			ApplicationEnvironmentVariable['Read']
		>;
		application_environment_variable?: Array<
			ApplicationEnvironmentVariable['Read']
		>;
		application__has__config_var_name?: Array<
			ApplicationConfigVariable['Read']
		>;
		application_config_variable?: Array<ApplicationConfigVariable['Read']>;
		application__has__service_name?: Array<Service['Read']>;
		service?: Array<Service['Read']>;
		application__has__tag_key?: Array<ApplicationTag['Read']>;
		application_tag?: Array<ApplicationTag['Read']>;
		owns__device?: Array<Device['Read']>;
		owns__release?: Array<Release['Read']>;
	};
	Write: {
		created_at: Types['Date Time']['Write'];
		modified_at: Types['Date Time']['Write'];
		id: Types['Serial']['Write'];
		actor: Actor['Write']['id'];
		should_track_latest_release: Types['Boolean']['Write'];
		is_of__class: 'fleet' | 'block' | 'app';
		organization: Organization['Write']['id'];
		app_name: Types['Text']['Write'];
		slug: Types['Short Text']['Write'];
		is_for__device_type: DeviceType['Write']['id'];
		should_be_running__release: Release['Write']['id'] | null;
		application_type: ApplicationType['Write']['id'];
		is_host: Types['Boolean']['Write'];
		is_archived: Types['Boolean']['Write'];
		uuid: Types['Text']['Write'];
		is_public: Types['Boolean']['Write'];
	};
}

export interface UserHasDirectAccessToApplication {
	Read: {
		id: Types['Big Integer']['Read'];
		user: { __id: User['Read']['id'] } | [User['Read']];
		has_direct_access_to__application:
			| { __id: Application['Read']['id'] }
			| [Application['Read']];
		application: { __id: Application['Read']['id'] } | [Application['Read']];
		is_directly_accessible_by__user:
			| { __id: User['Read']['id'] }
			| [User['Read']];
	};
	Write: {
		id: Types['Big Integer']['Write'];
		user: User['Write']['id'];
		has_direct_access_to__application: Application['Write']['id'];
	};
}

export default interface $Model {
	actor: Actor;
	permission: Permission;
	role: Role;
	role__has__permission: RoleHasPermission;
	user: User;
	user__has__role: UserHasRole;
	user__has__permission: UserHasPermission;
	api_key: ApiKey;
	api_key__has__role: ApiKeyHasRole;
	api_key__has__permission: ApiKeyHasPermission;
	application_type: ApplicationType;
	config: Config;
	cpu_architecture: CpuArchitecture;
	device_family: DeviceFamily;
	device_manufacturer: DeviceManufacturer;
	device_type: DeviceType;
	image: Image;
	organization: Organization;
	scheduled_job_run: ScheduledJobRun;
	service_instance: ServiceInstance;
	application: Application;
	application__has__env_var_name: ApplicationEnvironmentVariable;
	application__has__config_var_name: ApplicationConfigVariable;
	application__has__service_name: Service;
	application__has__service_name__has__label_name: ServiceLabel;
	application__has__service_name__has__name: ServiceEnvironmentVariable;
	application__has__tag_key: ApplicationTag;
	device: Device;
	device__has__env_var_name: DeviceEnvironmentVariable;
	device__has__config_var_name: DeviceConfigVariable;
	device__installs__image: ImageInstall;
	device__installs__application__has__service_name: ServiceInstall;
	device__installs__application__has__service_name__has__name: DeviceServiceEnvironmentVariable;
	device__has__tag_key: DeviceTag;
	release: Release;
	release__has__tag_key: ReleaseTag;
	image__is_part_of__release: ImageIsPartOfRelease;
	image__is_part_of__release__has__label_name: ImageLabel;
	image__is_part_of__release__has__name: ImageEnvironmentVariable;
	user__is_member_of__organization: OrganizationMembership;
	user__has__public_key: UserHasPublicKey;
	device_type__is_referenced_by__alias: DeviceTypeAlias;
	release__has__asset_key: ReleaseAsset;
	my_application: MyApplication;
	user__has_direct_access_to__application: UserHasDirectAccessToApplication;
	// Synonyms
	user_role: UserHasRole;
	user_permission: UserHasPermission;
	application_environment_variable: ApplicationEnvironmentVariable;
	application_config_variable: ApplicationConfigVariable;
	service: Service;
	service_label: ServiceLabel;
	service_environment_variable: ServiceEnvironmentVariable;
	application_tag: ApplicationTag;
	device_environment_variable: DeviceEnvironmentVariable;
	device_config_variable: DeviceConfigVariable;
	image_install: ImageInstall;
	service_install: ServiceInstall;
	device_service_environment_variable: DeviceServiceEnvironmentVariable;
	device_tag: DeviceTag;
	release_tag: ReleaseTag;
	release_image: ImageIsPartOfRelease;
	image_label: ImageLabel;
	image_environment_variable: ImageEnvironmentVariable;
	organization_membership: OrganizationMembership;
	user_public_key: UserHasPublicKey;
	device_type_alias: DeviceTypeAlias;
	release_asset: ReleaseAsset;
}

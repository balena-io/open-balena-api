import {
	PineResourceBase,
	NavigationResource,
	ReverseNavigationResource,
} from './utils';

export interface User extends PineResourceBase {
	username: string;
	password: string;
	jwt_secret: string;
}

export interface Application extends PineResourceBase {
	app_name: string;
	device_type: string;
	slug: string;
	commit: string;
	should_track_latest_release: boolean;

	application_type: NavigationResource<ApplicationType>;
	user: NavigationResource<User>;
	depends_on__application: NavigationResource<Application>;

	application_config_variable: ReverseNavigationResource<ApplicationVariable>;
	application_environment_variable: ReverseNavigationResource<
		ApplicationVariable
	>;
	application_tag: ReverseNavigationResource<ApplicationTag>;
	owns__device: ReverseNavigationResource<Device>;
	owns__release: ReverseNavigationResource<Release>;
	is_depended_on_by__application: ReverseNavigationResource<Application>;
}

export interface ApplicationType extends PineResourceBase {
	name: string;
	slug: string;
	description: string | null;
	supports_gateway_mode: boolean;
	supports_multicontainer: boolean;
	supports_web_url: boolean;
	is_legacy: boolean;
	requires_payment: boolean;
	needs__os_version_range: string | null;
	maximum_device_count: number | null;
}

type ReleaseStatus =
	| 'cancelled'
	| 'error'
	| 'failed'
	| 'interrupted'
	| 'local'
	| 'running'
	| 'success'
	| 'timeout';

export interface Release extends PineResourceBase {
	log: string;
	commit: string;
	composition: string | null;
	source: string;
	start_timestamp: Date;
	update_timestamp: Date;
	end_timestamp: Date | null;
	status: ReleaseStatus;

	is_created_by__user: NavigationResource<User>;
	belongs_to__application: NavigationResource<Application>;

	contains__image: ReverseNavigationResource<ReleaseImage>;
	release_tag: ReverseNavigationResource<ReleaseTag>;
}

export interface ReleaseImage extends PineResourceBase {
	image: NavigationResource<Image>;
	is_part_of__release: NavigationResource<Release>;

	image_environment_variable: ReverseNavigationResource<
		EnvironmentVariableBase
	>;
	image_label: ReverseNavigationResource<LabelBase>;
}

export interface Device extends PineResourceBase {
	app_name: string;
	custom_latitude: string | null;
	custom_longitude: string | null;
	device_name: string;
	device_type: string;
	download_progress: number | null;
	ip_address: string | null;
	is_connected_to_vpn: boolean;
	is_locked_until__date: Date | null;
	is_on__commit: string;
	is_online: boolean;
	last_connectivity_event: Date | null;
	last_vnp_event: Date | null;
	local_id: string | null;
	note: string;
	os_variant: string | null;
	os_version: string;
	provisioning_progress: number | null;
	provisioning_state: string;
	status: string | null;
	supervisor_version: string;
	uuid: string;
	vpn_address: string | null;

	belongs_to__application: NavigationResource<Application>;
	should_be_running__release: NavigationResource<Release>;
	is_managed_by__service__instance: NavigationResource<ServiceInstance>;
	is_managed_by__device: NavigationResource<Device>;

	device_config_variable: ReverseNavigationResource<DeviceVariable>;
	device_environment_variable: ReverseNavigationResource<DeviceVariable>;
	device_tag: ReverseNavigationResource<DeviceTag>;
	manages__device: ReverseNavigationResource<Device>;
	service_install: ReverseNavigationResource<ServiceInstall>;
}

export interface ServiceInstance extends PineResourceBase {
	service_type: string;
	ip_address: string;
	last_heartbeat: Date;
}

export interface Service extends PineResourceBase {
	service_name: string;

	application: NavigationResource<Application>;

	service_environment_variable: ReverseNavigationResource<
		ServiceEnvironmentVariable
	>;
	service_label: ReverseNavigationResource<LabelBase>;
}

export interface Image extends PineResourceBase {
	build_log: string;
	content_hash: string | null;
	project_type: string | null;
	status: string;
	is_stored_at__image_location: string;
	start_timestamp: Date;
	push_timestamp: Date | null;
	end_timestamp: Date | null;
	image_size: number | null;
	dockerfile: string;
	error_message: string | null;

	is_a_build_of__service: NavigationResource<Service>;
}

export interface ServiceInstall extends PineResourceBase {
	device: NavigationResource<Device>;
	installs__service: NavigationResource<Service>;
	service: NavigationResource<Service>;

	device_service_environment_variable: ReverseNavigationResource<
		DeviceServiceEnvironmentVariable
	>;
}

export interface EnvironmentVariableBase extends PineResourceBase {
	name: string;
	value: string;
}

export interface DeviceServiceEnvironmentVariable
	extends EnvironmentVariableBase {
	service_install: NavigationResource<ServiceInstall>;
}

export interface ServiceEnvironmentVariable extends EnvironmentVariableBase {
	service: NavigationResource<Service>;
}

export interface DeviceVariable extends EnvironmentVariableBase {
	device: NavigationResource<Device>;
}

export interface ApplicationVariable extends EnvironmentVariableBase {
	application: NavigationResource<Application>;
}

export interface ResourceTagBase extends PineResourceBase {
	tag_key: string;
	value: string;
}

export interface ApplicationTag extends ResourceTagBase {
	application: NavigationResource<Application>;
}

export interface DeviceTag extends ResourceTagBase {
	device: NavigationResource<Device>;
}

export interface ReleaseTag extends ResourceTagBase {
	release: NavigationResource<Release>;
}

export interface LabelBase extends PineResourceBase {
	label_name: string;
	value: string;
}

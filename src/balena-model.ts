/**
 * This file is auto-generated with `npm run generate-model-types`
 */

export type DateString = string;
export type Expanded<T> = Extract<T, any[]>;
export type PickExpanded<T, K extends keyof T> = {
	[P in K]: Expanded<T[P]>;
};
export type Deferred<T> = Exclude<T, any[]>;
export type PickDeferred<T, K extends keyof T> = {
	[P in K]: Deferred<T[P]>;
};

export interface Actor {
	created_at: DateString;
	modified_at: DateString;
	id: number;
}

export interface Permission {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	name: string;
}

export interface Role {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	name: string;
}

export interface RoleHasPermission {
	created_at: DateString;
	modified_at: DateString;
	role: { __id: number } | [Role];
	permission: { __id: number } | [Permission];
	id: number;
}

export interface User {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	actor: number;
	username: string;
	password: string | null;
	jwt_secret: string | null;
	email: string | null;
}

export interface UserHasRole {
	created_at: DateString;
	modified_at: DateString;
	user: { __id: number } | [User];
	role: { __id: number } | [Role];
	id: number;
	expiry_date: DateString | null;
}

export interface UserHasPermission {
	created_at: DateString;
	modified_at: DateString;
	user: { __id: number } | [User];
	permission: { __id: number } | [Permission];
	id: number;
	expiry_date: DateString | null;
}

export interface ApiKey {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	key: string;
	is_of__actor: { __id: number } | [Actor];
	name: string | null;
	description: string | null;
}

export interface ApiKeyHasRole {
	created_at: DateString;
	modified_at: DateString;
	api_key: { __id: number } | [ApiKey];
	role: { __id: number } | [Role];
	id: number;
}

export interface ApiKeyHasPermission {
	created_at: DateString;
	modified_at: DateString;
	api_key: { __id: number } | [ApiKey];
	permission: { __id: number } | [Permission];
	id: number;
}

export interface ApplicationType {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	name: string;
	supports_web_url: boolean;
	supports_multicontainer: boolean;
	supports_gateway_mode: boolean;
	needs__os_version_range: string | null;
	requires_payment: boolean;
	is_legacy: boolean;
	slug: string;
	description: string | null;
	maximum_device_count: number | null;
}

export interface CpuArchitecture {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	slug: string;
}

export interface Config {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	key: string;
	value: string;
	scope: string | null;
	description: string | null;
}

export interface DeviceType {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	slug: string;
	name: string;
	is_of__cpu_architecture: { __id: number } | [CpuArchitecture];
	logo: string | null;
	belongs_to__device_family: { __id: number } | [DeviceFamily?] | null;
}

export interface DeviceFamily {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	slug: string;
	name: string;
	is_manufactured_by__device_manufacturer:
		| { __id: number }
		| [DeviceManufacturer?]
		| null;
}

export interface DeviceManufacturer {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	slug: string;
	name: string;
}

export interface Image {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	start_timestamp: DateString;
	end_timestamp: DateString | null;
	dockerfile: string | null;
	is_a_build_of__service: { __id: number } | [Service];
	image_size: number | null;
	is_stored_at__image_location: string;
	project_type: string | null;
	error_message: string | null;
	build_log: string | null;
	push_timestamp: DateString | null;
	status: string;
	content_hash: string | null;
	contract: {} | null;
}

export interface Organization {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	name: string;
	handle: string;
}

export interface ServiceInstance {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	service_type: string;
	ip_address: string;
	last_heartbeat: DateString;
}

export interface Application {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	actor: number;
	should_track_latest_release: boolean;
	organization: { __id: number } | [Organization];
	app_name: string;
	slug: string;
	is_for__device_type: { __id: number } | [DeviceType];
	should_be_running__release: { __id: number } | [Release?] | null;
	depends_on__application: { __id: number } | [Application?] | null;
	application_type: { __id: number } | [ApplicationType];
	is_host: boolean;
	is_archived: boolean;
	uuid: string;
	is_public: boolean;
	install_type: 'hostapp' | 'hostapp extension' | 'supervised' | 'supervisor';
}

export interface ApplicationEnvironmentVariable {
	created_at: DateString;
	modified_at: DateString;
	application: { __id: number } | [Application];
	name: string;
	id: number;
	value: string;
}

export interface ApplicationConfigVariable {
	created_at: DateString;
	modified_at: DateString;
	application: { __id: number } | [Application];
	name: string;
	id: number;
	value: string;
}

export interface Service {
	created_at: DateString;
	modified_at: DateString;
	application: { __id: number } | [Application];
	service_name: string;
	id: number;
}

export interface ServiceLabel {
	created_at: DateString;
	modified_at: DateString;
	service: { __id: number } | [Service];
	label_name: string;
	id: number;
	value: string;
}

export interface ServiceEnvironmentVariable {
	created_at: DateString;
	modified_at: DateString;
	service: { __id: number } | [Service];
	name: string;
	id: number;
	value: string;
}

export interface ApplicationTag {
	created_at: DateString;
	modified_at: DateString;
	application: { __id: number } | [Application];
	tag_key: string;
	id: number;
	value: string;
}

export interface Device {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	actor: number;
	api_heartbeat_state: 'online' | 'offline' | 'timeout' | 'unknown';
	uuid: string;
	local_id: string | null;
	device_name: string | null;
	note: string | null;
	is_of__device_type: { __id: number } | [DeviceType];
	belongs_to__application: { __id: number } | [Application?] | null;
	is_online: boolean;
	last_connectivity_event: DateString | null;
	is_connected_to_vpn: boolean;
	last_vpn_event: DateString | null;
	is_locked_until__date: DateString | null;
	logs_channel: string | null;
	public_address: string | null;
	vpn_address: string | null;
	ip_address: string | null;
	mac_address: string | null;
	memory_usage: number | null;
	memory_total: number | null;
	storage_block_device: string | null;
	storage_usage: number | null;
	storage_total: number | null;
	cpu_usage: number | null;
	cpu_temp: number | null;
	is_undervolted: boolean;
	cpu_id: string | null;
	is_running__release: { __id: number } | [Release?] | null;
	download_progress: number | null;
	status: string | null;
	os_version: string | null;
	os_variant: string | null;
	supervisor_version: string | null;
	provisioning_progress: number | null;
	provisioning_state: string | null;
	api_port: number | null;
	api_secret: string | null;
	is_managed_by__service_instance: { __id: number } | [ServiceInstance?] | null;
	should_be_running__release: { __id: number } | [Release?] | null;
	is_managed_by__device: { __id: number } | [Device?] | null;
	should_be_managed_by__release: { __id: number } | [Release?] | null;
	is_web_accessible: boolean | null;
	overall_status: string | null;
	overall_progress: number | null;
}

export interface DeviceEnvironmentVariable {
	created_at: DateString;
	modified_at: DateString;
	device: { __id: number } | [Device];
	name: string;
	id: number;
	value: string;
}

export interface DeviceConfigVariable {
	created_at: DateString;
	modified_at: DateString;
	device: { __id: number } | [Device];
	name: string;
	id: number;
	value: string;
}

export interface ImageInstall {
	created_at: DateString;
	modified_at: DateString;
	device: { __id: number } | [Device];
	installs__image: { __id: number } | [Image];
	id: number;
	install_date: DateString;
	download_progress: number | null;
	status: string;
	is_provided_by__release: { __id: number } | [Release];
}

export interface ServiceInstall {
	created_at: DateString;
	modified_at: DateString;
	device: { __id: number } | [Device];
	installs__service: { __id: number } | [Service];
	id: number;
}

export interface DeviceServiceEnvironmentVariable {
	created_at: DateString;
	modified_at: DateString;
	service_install: { __id: number } | [ServiceInstall];
	name: string;
	id: number;
	value: string;
}

export interface DeviceTag {
	created_at: DateString;
	modified_at: DateString;
	device: { __id: number } | [Device];
	tag_key: string;
	id: number;
	value: string;
}

export interface Release {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	belongs_to__application: { __id: number } | [Application];
	commit: string;
	composition: {};
	status: string;
	source: string;
	build_log: string | null;
	is_invalidated: boolean;
	start_timestamp: DateString;
	end_timestamp: DateString | null;
	update_timestamp: DateString;
	release_version: string | null;
	contract: {} | null;
	is_passing_tests: boolean;
	release_type: 'final' | 'draft';
}

export interface ReleaseTag {
	created_at: DateString;
	modified_at: DateString;
	release: { __id: number } | [Release];
	tag_key: string;
	id: number;
	value: string;
}

export interface GatewayDownload {
	created_at: DateString;
	modified_at: DateString;
	image: { __id: number } | [Image];
	is_downloaded_by__device: { __id: number } | [Device];
	id: number;
	status: string;
	download_progress: number | null;
}

export interface ImageIsPartOfRelease {
	created_at: DateString;
	modified_at: DateString;
	image: { __id: number } | [Image];
	is_part_of__release: { __id: number } | [Release];
	id: number;
}

export interface ImageLabel {
	created_at: DateString;
	modified_at: DateString;
	release_image: { __id: number } | [ImageIsPartOfRelease];
	label_name: string;
	id: number;
	value: string;
}

export interface ImageEnvironmentVariable {
	created_at: DateString;
	modified_at: DateString;
	release_image: { __id: number } | [ImageIsPartOfRelease];
	name: string;
	id: number;
	value: string;
}

export interface OrganizationMembership {
	created_at: DateString;
	modified_at: DateString;
	user: { __id: number } | [User];
	is_member_of__organization: { __id: number } | [Organization];
	id: number;
}

export interface UserHasPublicKey {
	created_at: DateString;
	modified_at: DateString;
	user: { __id: number } | [User];
	public_key: string;
	id: number;
	title: string;
}

export interface MyApplication {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	actor: number;
	should_track_latest_release: boolean;
	organization: { __id: number } | [Organization];
	app_name: string;
	slug: string;
	is_for__device_type: { __id: number } | [DeviceType];
	should_be_running__release: { __id: number } | [Release?] | null;
	depends_on__application: { __id: number } | [Application?] | null;
	application_type: { __id: number } | [ApplicationType];
	is_host: boolean;
	is_archived: boolean;
	uuid: string;
	is_public: boolean;
	install_type: 'hostapp' | 'hostapp extension' | 'supervised' | 'supervisor';
}

export interface UserHasDirectAccessToApplication {
	id: number;
	user: { __id: number } | [User];
	has_direct_access_to__application: { __id: number } | [Application];
}

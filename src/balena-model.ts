/**
 * This file is auto-generated with `npm run generate-model-types`
 */

export type DateString = string;
export type Expanded<T> = Extract<T, any[]>;
export type PickExpanded<T, K extends keyof T> = {
	[P in K]-?: Expanded<T[P]>;
};
export type Deferred<T> = Exclude<T, any[]>;
export type PickDeferred<T, K extends keyof T> = {
	[P in K]: Deferred<T[P]>;
};
export interface WebResource {
	filename: string;
	href: string;
	content_type?: string;
	content_disposition?: string;
	size?: number;
}

export interface Actor {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	is_of__user?: User[];
	is_of__application?: Application[];
	is_of__device?: Device[];
	api_key?: ApiKey[];
}

export interface Permission {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	name: string;
	is_of__role?: RoleHasPermission[];
	is_of__user?: UserHasPermission[];
	is_of__api_key?: ApiKeyHasPermission[];
	user__has__permission?: UserHasPermission[];
	user_permission?: UserHasPermission[];
}

export interface Role {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	name: string;
	role__has__permission?: RoleHasPermission[];
	user__has__role?: UserHasRole[];
	user_role?: UserHasRole[];
	is_of__user?: UserHasRole[];
	is_of__api_key?: ApiKeyHasRole[];
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
	actor: { __id: number } | [Actor];
	username: string;
	password: string | null;
	jwt_secret: string | null;
	email: string | null;
	user__has__role?: UserHasRole[];
	user_role?: UserHasRole[];
	user__has__permission?: UserHasPermission[];
	user_permission?: UserHasPermission[];
	user__has__public_key?: UserHasPublicKey[];
	user_public_key?: UserHasPublicKey[];
	user__is_member_of__organization?: OrganizationMembership[];
	organization_membership?: OrganizationMembership[];
	is_member_of__organization?: OrganizationMembership[];
	has_direct_access_to__application?: UserHasDirectAccessToApplication[];
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
	expiry_date: DateString | null;
	is_of__actor: { __id: number } | [Actor];
	name: string | null;
	description: string | null;
	api_key__has__role?: ApiKeyHasRole[];
	api_key__has__permission?: ApiKeyHasPermission[];
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
	is_of__application?: Application[];
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

export interface CpuArchitecture {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	slug: string;
	is_supported_by__device_type?: DeviceType[];
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
	device_type?: DeviceType[];
}

export interface DeviceManufacturer {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	slug: string;
	name: string;
	manufactures__device_family?: DeviceFamily[];
}

export interface DeviceType {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	slug: string;
	name: string;
	is_of__cpu_architecture: { __id: number } | [CpuArchitecture];
	logo: string | null;
	contract: object | null;
	belongs_to__device_family: { __id: number } | [DeviceFamily?] | null;
	is_default_for__application?: Application[];
	describes__device?: Device[];
	device_type__is_referenced_by__alias?: DeviceTypeAlias[];
	device_type_alias?: DeviceTypeAlias[];
	is_referenced_by__alias?: DeviceTypeAlias[];
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
	contract: object | null;
	device__installs__image?: ImageInstall[];
	image_install?: ImageInstall[];
	is_installed_on__device?: ImageInstall[];
	is_part_of__release?: ImageIsPartOfRelease[];
	image__is_part_of__release?: ImageIsPartOfRelease[];
	release_image?: ImageIsPartOfRelease[];
}

export interface Organization {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	name: string;
	handle: string;
	user__is_member_of__organization?: OrganizationMembership[];
	organization_membership?: OrganizationMembership[];
	includes__user?: OrganizationMembership[];
	application?: Application[];
}

export interface ScheduledJobRun {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	name: string;
	start_timestamp: DateString;
	end_timestamp: DateString | null;
	status: 'running' | 'success' | 'error';
}

export interface ServiceInstance {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	service_type: string;
	ip_address: string;
	last_heartbeat: DateString;
	manages__device?: Device[];
}

export interface Application {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	actor: { __id: number } | [Actor];
	should_track_latest_release: boolean;
	is_of__class: 'fleet' | 'block' | 'app';
	organization: { __id: number } | [Organization];
	app_name: string;
	slug: string;
	is_for__device_type: { __id: number } | [DeviceType];
	should_be_running__release: { __id: number } | [Release?] | null;
	application_type: { __id: number } | [ApplicationType];
	is_host: boolean;
	is_archived: boolean;
	uuid: string;
	is_public: boolean;
	application__has__env_var_name?: ApplicationEnvironmentVariable[];
	application_environment_variable?: ApplicationEnvironmentVariable[];
	application__has__config_var_name?: ApplicationConfigVariable[];
	application_config_variable?: ApplicationConfigVariable[];
	application__has__service_name?: Service[];
	service?: Service[];
	application__has__tag_key?: ApplicationTag[];
	application_tag?: ApplicationTag[];
	owns__device?: Device[];
	owns__release?: Release[];
	is_directly_accessible_by__user?: UserHasDirectAccessToApplication[];
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
	application__has__service_name__has__label_name?: ServiceLabel[];
	service_label?: ServiceLabel[];
	application__has__service_name__has__name?: ServiceEnvironmentVariable[];
	service_environment_variable?: ServiceEnvironmentVariable[];
	device__installs__application__has__service_name?: ServiceInstall[];
	service_install?: ServiceInstall[];
	is_installed_on__device?: ServiceInstall[];
	is_built_by__image?: Image[];
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
	actor: { __id: number } | [Actor];
	api_heartbeat_state: 'online' | 'offline' | 'timeout' | 'unknown';
	last_changed_api_heartbeat_state_on__date: DateString | null;
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
	public_address: string | null;
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
	should_be_operated_by__release: { __id: number } | [Release?] | null;
	should_be_managed_by__release: { __id: number } | [Release?] | null;
	is_web_accessible: boolean | null;
	is_frozen: boolean | null;
	overall_status: string | null;
	overall_progress: number | null;
	device__has__env_var_name?: DeviceEnvironmentVariable[];
	device_environment_variable?: DeviceEnvironmentVariable[];
	device__has__config_var_name?: DeviceConfigVariable[];
	device_config_variable?: DeviceConfigVariable[];
	device__has__tag_key?: DeviceTag[];
	device_tag?: DeviceTag[];
	device__installs__image?: ImageInstall[];
	image_install?: ImageInstall[];
	device__installs__application__has__service_name?: ServiceInstall[];
	service_install?: ServiceInstall[];
	installs__image?: ImageInstall[];
	installs__application__has__service_name?: ServiceInstall[];
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
	device__installs__application__has__service_name__has__name?: DeviceServiceEnvironmentVariable[];
	device_service_environment_variable?: DeviceServiceEnvironmentVariable[];
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
	composition: object;
	status: string;
	source: string;
	build_log: string | null;
	is_invalidated: boolean;
	start_timestamp: DateString;
	end_timestamp: DateString | null;
	update_timestamp: DateString;
	release_version: string | null;
	contract: object | null;
	is_passing_tests: boolean;
	is_finalized_at__date: DateString | null;
	phase: 'next' | 'current' | 'sunset' | 'end-of-life' | null;
	semver_major: number;
	semver_minor: number;
	semver_patch: number;
	semver_prerelease: string;
	semver_build: string;
	variant: string;
	revision: number | null;
	known_issue_list: string | null;
	note: string | null;
	invalidation_reason: string | null;
	is_final: boolean;
	semver: string;
	raw_version: string;
	version: object;
	release__has__tag_key?: ReleaseTag[];
	release_tag?: ReleaseTag[];
	release__has__asset_key?: ReleaseAsset[];
	release_asset?: ReleaseAsset[];
	image__is_part_of__release?: ImageIsPartOfRelease[];
	release_image?: ImageIsPartOfRelease[];
	contains__image?: ImageIsPartOfRelease[];
	should_be_running_on__application?: Application[];
	should_be_running_on__device?: Device[];
	is_running_on__device?: Device[];
	should_operate__device?: Device[];
	should_manage__device?: Device[];
	provides__device__installs__image?: ImageInstall[];
}

export interface ReleaseTag {
	created_at: DateString;
	modified_at: DateString;
	release: { __id: number } | [Release];
	tag_key: string;
	id: number;
	value: string;
}

export interface ImageIsPartOfRelease {
	created_at: DateString;
	modified_at: DateString;
	image: { __id: number } | [Image];
	is_part_of__release: { __id: number } | [Release];
	id: number;
	image__is_part_of__release__has__label_name?: ImageLabel[];
	image_label?: ImageLabel[];
	image__is_part_of__release__has__name?: ImageEnvironmentVariable[];
	image_environment_variable?: ImageEnvironmentVariable[];
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

export interface DeviceTypeAlias {
	created_at: DateString;
	modified_at: DateString;
	device_type: { __id: number } | [DeviceType];
	is_referenced_by__alias: string;
	id: number;
}

export interface ReleaseAsset {
	created_at: DateString;
	modified_at: DateString;
	release: { __id: number } | [Release];
	asset_key: string;
	id: number;
	asset: WebResource;
}

export interface MyApplication {
	created_at: DateString;
	modified_at: DateString;
	id: number;
	actor: { __id: number } | [Actor];
	should_track_latest_release: boolean;
	is_of__class: 'fleet' | 'block' | 'app';
	organization: { __id: number } | [Organization];
	app_name: string;
	slug: string;
	is_for__device_type: { __id: number } | [DeviceType];
	should_be_running__release: { __id: number } | [Release?] | null;
	application_type: { __id: number } | [ApplicationType];
	is_host: boolean;
	is_archived: boolean;
	uuid: string;
	is_public: boolean;
	application__has__env_var_name?: ApplicationEnvironmentVariable[];
	application_environment_variable?: ApplicationEnvironmentVariable[];
	application__has__config_var_name?: ApplicationConfigVariable[];
	application_config_variable?: ApplicationConfigVariable[];
	application__has__service_name?: Service[];
	service?: Service[];
	application__has__tag_key?: ApplicationTag[];
	application_tag?: ApplicationTag[];
	owns__device?: Device[];
	owns__release?: Release[];
}

export interface UserHasDirectAccessToApplication {
	id: number;
	user: { __id: number } | [User];
	has_direct_access_to__application: { __id: number } | [Application];
}

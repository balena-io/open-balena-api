export const balenaUserActions = {
	user_login: {
		description: 'Triggered everytime a user logs in',
	},
	user_logout: {
		description: 'Triggered everytime a user logs out',
	},
	user_profile_updated: {
		description: 'Triggered when a user updates their profile',
	},
} as const;
export const balenaOrgActions = {
	release_created: {
		description: 'Triggered once a new release is created for a given fleet',
	},
	org_member_added: {
		description: 'Triggered when a new member is added to an organization',
	},
	org_member_removed: {
		description: 'Triggered when a member is removed from an organization',
	},
	org_settings_updated: {
		description: 'Triggered when organization settings are updated',
	},
	org_application_created: {
		description: 'Triggered when a new application is created in an organization',
	},
} as const;

export type BalenaUserAction = keyof typeof balenaUserActions;
export type BalenaOrgAction = keyof typeof balenaOrgActions;

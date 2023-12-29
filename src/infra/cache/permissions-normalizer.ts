import type { permissions } from '@balena/pinejs';

export const reqPermissionNormalizer = (req: permissions.PermissionReq) => {
	const userOrApiKey =
		req.user?.permissions != null
			? req.user
			: req.apiKey?.permissions != null
				? req.apiKey
				: null;
	return `${userOrApiKey?.actor}$${userOrApiKey?.permissions}`;
};

import type { permissions } from '@balena/pinejs';
import fnv1a from '@sindresorhus/fnv1a';

const hashPermissions = (permissions: string[] | undefined): string => {
	if (permissions == null) {
		return '';
	}
	return `${fnv1a(permissions.join()).toString(36)}${permissions.length}`;
};

export const reqPermissionNormalizer = (req: permissions.PermissionReq) => {
	const userOrApiKey =
		req.user?.permissions != null
			? req.user
			: req.apiKey?.permissions != null
				? req.apiKey
				: null;
	return `${userOrApiKey?.actor}$${hashPermissions(userOrApiKey?.permissions)}`;
};

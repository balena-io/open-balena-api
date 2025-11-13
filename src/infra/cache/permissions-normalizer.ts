import type { permissions } from '@balena/pinejs';
import fnv1a from '@sindresorhus/fnv1a';

// Pre-allocate a buffer to improve performance when hashing permissions / reduce allocations
const opts = { utf8Buffer: new Uint8Array(256) };
const hashPermissions = (permissions: string[] | undefined): string => {
	if (permissions == null) {
		return '';
	}
	return `${fnv1a(permissions.join(), opts).toString(36)}${permissions.length}`;
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

import type { permissions } from '@balena/pinejs';
import { fnv1a64Base36 } from 'fnv1a-64';

const hashPermissions = (permissions: string[] | undefined): string => {
	if (permissions == null) {
		return '';
	}
	return `${fnv1a64Base36(permissions.join())}${permissions.length}`;
};

export const reqPermissionNormalizer = (req: permissions.PermissionReq) => {
	// This mirrors pinejs' `getReqPermissions`. Note that a `req.user` set by `getUser`
	// for a user api key has no `permissions`, so it falls through to `req.apiKey` here,
	// just as it does in pinejs
	const userOrApiKey =
		req.user?.permissions != null
			? req.user
			: req.apiKey?.permissions != null
				? req.apiKey
				: null;
	return `${userOrApiKey?.actor}$${hashPermissions(userOrApiKey?.permissions)}`;
};

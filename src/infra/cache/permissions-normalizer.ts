import type { permissions } from '@balena/pinejs';
import { fnv1a64Base36 } from 'fnv1a-64';

const hashPermissions = (permissions: string[] | undefined): string => {
	if (permissions == null) {
		return '';
	}
	return `${fnv1a64Base36(permissions.join())}${permissions.length}`;
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

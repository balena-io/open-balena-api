export const getApplicationSlug = (
	orgHandle: string,
	appName: string,
): string => {
	if (orgHandle == null) {
		throw new Error('Missing organization handle');
	}

	if (appName == null) {
		throw new Error('Missing application name');
	}

	return `${orgHandle}/${appName}`.toLowerCase();
};

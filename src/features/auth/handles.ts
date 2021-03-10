const normalizeReplacements = /[^\w]+/g;

export const normalizeHandle = (handle: string): string => {
	return handle.replace(normalizeReplacements, '_').toLowerCase();
};

import type { ErrorEvent } from '@sentry/node';

const FILTERED = '[Filtered]';

// The same snippets that Sentry uses to redact headers, cookies and query params,
// which it does not apply to request bodies
const SENSITIVE_KEY_SNIPPETS = [
	'auth',
	'token',
	'secret',
	'session',
	'password',
	'passwd',
	'pwd',
	'key',
	'jwt',
	'bearer',
	'sso',
	'saml',
	'csrf',
	'xsrf',
	'credentials',
	'sid',
	'identity',
	'cookie',
];
// The `value` of an env/config var is arbitrary user data that is often a secret
const VARIABLE_RESOURCE_REGEX = /_(?:environment|config)_variable\b/;
const URLENCODED_REGEX = /^application\/x-www-form-urlencoded\b/i;

const isSensitiveKey = (key: string, extraSensitiveKeys: string[]) => {
	const lowerKey = key.toLowerCase();
	return (
		extraSensitiveKeys.includes(lowerKey) ||
		SENSITIVE_KEY_SNIPPETS.some((snippet) => lowerKey.includes(snippet))
	);
};

const redactSensitiveKeys = (
	value: unknown,
	extraSensitiveKeys: string[],
): unknown => {
	if (Array.isArray(value)) {
		return value.map((v) => redactSensitiveKeys(v, extraSensitiveKeys));
	}
	if (value != null && typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value).map(([key, v]) => [
				key,
				isSensitiveKey(key, extraSensitiveKeys)
					? FILTERED
					: redactSensitiveKeys(v, extraSensitiveKeys),
			]),
		);
	}
	return value;
};

/**
 * A Sentry `beforeSend` that redacts the values of sensitive looking keys in JSON and
 * urlencoded request bodies, and the entirety of any other request body (including
 * JSON that was truncated) as we cannot tell what it contains
 */
export const redactRequestBody = (event: ErrorEvent): ErrorEvent => {
	const { request } = event;
	const data = request?.data;
	if (request == null || data == null) {
		return event;
	}
	const extraSensitiveKeys =
		request.url != null && VARIABLE_RESOURCE_REGEX.test(request.url)
			? ['value']
			: [];
	if (typeof data !== 'string') {
		request.data = redactSensitiveKeys(data, extraSensitiveKeys);
		return event;
	}
	try {
		request.data = JSON.stringify(
			redactSensitiveKeys(JSON.parse(data), extraSensitiveKeys),
		);
	} catch {
		const contentType = request.headers?.['content-type'] ?? '';
		if (URLENCODED_REGEX.test(contentType)) {
			const params = new URLSearchParams(data);
			for (const key of new Set(params.keys())) {
				if (isSensitiveKey(key, extraSensitiveKeys)) {
					params.set(key, FILTERED);
				}
			}
			request.data = params.toString();
		} else {
			request.data = FILTERED;
		}
	}
	return event;
};

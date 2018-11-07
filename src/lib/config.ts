import * as _ from 'lodash';

export const requiredVar = (varName: string): string => {
	const s = process.env[varName];
	if (s == null) {
		console.error(`Missing environment variable: ${varName}`);
		process.exit(1);
		throw new Error('Unreachable');
	}
	return s;
};

export function intVar(varName: string): number;
export function intVar<R>(varName: string, defaultValue: R): number | R;
export function intVar<R>(varName: string, defaultValue?: R): number | R {
	if (arguments.length === 1) {
		requiredVar(varName);
	}

	const s = process.env[varName];
	if (s == null) {
		return defaultValue!;
	}
	const i = parseInt(s, 10);
	if (!_.isFinite(i)) {
		throw new Error(`${varName} must be a valid number if set`);
	}
	return i;
}

export const API_HOST = requiredVar('API_HOST');
export const API_VPN_SERVICE_API_KEY = requiredVar('API_VPN_SERVICE_API_KEY');
export const AUTH_RESINOS_REGISTRY_CODE =
	process.env.AUTH_RESINOS_REGISTRY_CODE;
export const COOKIE_SESSION_SECRET = requiredVar('COOKIE_SESSION_SECRET');
export const DB_POOL_SIZE = intVar('DB_POOL_SIZE', undefined);
export const DELTA_HOST = requiredVar('DELTA_HOST');
export const DEVICE_CONFIG_OPENVPN_CA = requiredVar('DEVICE_CONFIG_OPENVPN_CA');
export const DEVICE_CONFIG_OPENVPN_CONFIG = requiredVar(
	'DEVICE_CONFIG_OPENVPN_CONFIG',
);
export const DEVICE_CONFIG_SSH_AUTHORIZED_KEYS =
	process.env.DEVICE_CONFIG_SSH_AUTHORIZED_KEYS || '';
export const EXTERNAL_HTTP_TIMEOUT_MS = intVar(
	'EXTERNAL_HTTP_TIMEOUT_MS',
	25000,
);
export const IMAGE_MAKER_URL = requiredVar('IMAGE_MAKER_URL');
export const IMAGE_STORAGE_BUCKET = requiredVar('IMAGE_STORAGE_BUCKET');
export const IMAGE_STORAGE_ENDPOINT = requiredVar('IMAGE_STORAGE_ENDPOINT');
export const IMAGE_STORAGE_PREFIX = requiredVar('IMAGE_STORAGE_PREFIX');
export const IMAGE_STORAGE_FORCE_PATH_STYLE =
	process.env.IMAGE_STORAGE_FORCE_PATH_STYLE === 'true';
export const JSON_WEB_TOKEN_EXPIRY_MINUTES = intVar(
	'JSON_WEB_TOKEN_EXPIRY_MINUTES',
);
export const JSON_WEB_TOKEN_SECRET = requiredVar('JSON_WEB_TOKEN_SECRET');
export const MIXPANEL_TOKEN = requiredVar('MIXPANEL_TOKEN');
export const NODE_ENV = process.env.NODE_ENV;
export const NODE_EXTRA_CA_CERTS = process.env.NODE_EXTRA_CA_CERTS;
export const RATE_LIMIT_FACTOR = intVar('RATE_LIMIT_FACTOR', 1);
export const RATE_LIMIT_MEMORY_BACKEND = process.env.RATE_LIMIT_MEMORY_BACKEND;
export const REDIS_HOST = requiredVar('REDIS_HOST');
export const REDIS_PORT = intVar('REDIS_PORT');
export const REGISTRY2_HOST = requiredVar('REGISTRY2_HOST');
export const REGISTRY_HOST = requiredVar('REGISTRY_HOST');
export const SENTRY_DSN = process.env.SENTRY_DSN;
export const SUPERUSER_EMAIL = process.env.SUPERUSER_EMAIL || '';
export const SUPERUSER_PASSWORD = process.env.SUPERUSER_PASSWORD || '';
export const TOKEN_AUTH_BUILDER_TOKEN = requiredVar('TOKEN_AUTH_BUILDER_TOKEN');
export const TOKEN_AUTH_CERT_ISSUER = requiredVar('TOKEN_AUTH_CERT_ISSUER');
export const TOKEN_AUTH_CERT_KEY = requiredVar('TOKEN_AUTH_CERT_KEY');
export const TOKEN_AUTH_CERT_KID = requiredVar('TOKEN_AUTH_CERT_KID');
export const TOKEN_AUTH_CERT_PUB = requiredVar('TOKEN_AUTH_CERT_PUB');
export const TOKEN_AUTH_JWT_ALGO = requiredVar('TOKEN_AUTH_JWT_ALGO');
export const VPN_HOST = requiredVar('VPN_HOST');
export const VPN_PORT = requiredVar('VPN_PORT');
export const VPN_SERVICE_API_KEY = requiredVar('VPN_SERVICE_API_KEY');

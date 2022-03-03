export let version: string;
export function setVersion(v: typeof version) {
	if (version !== undefined) {
		throw new Error(
			`Can only set version once, trying to replace '${version}' with '${v}'`,
		);
	}
	version = v;
}

export const SECONDS = 1000;
export const SECONDS_PER_HOUR = 60 * 60;
export const MINUTES = 60 * SECONDS;
export const HOURS = 60 * MINUTES;
export const DAYS = 24 * HOURS;

const openVpnConfig = `
client
remote {{VPN_DETAILS}}
resolv-retry infinite

remote-cert-tls server
tls-version-min 1.2
ca /etc/openvpn/ca.crt
auth-user-pass /var/volatile/vpn-auth
auth-retry none
script-security 2
up /etc/openvpn-misc/upscript.sh
up-restart
down /etc/openvpn-misc/downscript.sh

comp-lzo
dev resin-vpn
dev-type tun
proto tcp
nobind

persist-key
persist-tun
verb 3
user openvpn
group openvpn

reneg-bytes 0
reneg-pkts 0
reneg-sec 0
`;

export const requiredVar = (varName: string): string => {
	const s = process.env[varName];
	if (s == null) {
		process.exitCode = 1;
		throw new Error(`Missing environment variable: ${varName}`);
	}
	return s;
};

export function optionalVar(varName: string, defaultValue: string): string;
export function optionalVar(
	varName: string,
	defaultValue?: string,
): string | undefined;
export function optionalVar(
	varName: string,
	defaultValue?: string,
): string | undefined {
	return process.env[varName] || defaultValue;
}

export const checkInt = (s: string) => {
	const i = parseInt(s, 10);
	if (!Number.isFinite(i)) {
		return;
	}
	return i;
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

	const i = checkInt(s);
	if (i === undefined) {
		throw new Error(`${varName} must be a valid number if set`);
	}
	return i;
}

export function boolVar(varName: string): boolean;
export function boolVar<R>(varName: string, defaultValue: R): boolean | R;
export function boolVar<R>(varName: string, defaultValue?: R): boolean | R {
	if (arguments.length === 1) {
		requiredVar(varName);
	}

	const s = process.env[varName];
	if (s == null) {
		return defaultValue!;
	}
	if (s === 'false') {
		return false;
	}
	if (s === 'true') {
		return true;
	}
	throw new Error(
		`Invalid value for boolean var '${varName}', got '${s}', expected 'true' or 'false'`,
	);
}

export enum ADVISORY_LOCK_NAMESPACES {
	release__revision__belongs_to__application = 1,
}

export const API_HOST = requiredVar('API_HOST');
export const PORT = intVar('PORT', 1337);
export const API_HEARTBEAT_STATE_ENABLED = intVar(
	'API_HEARTBEAT_STATE_ENABLED',
	1, // 1 = enabled, 0 = disabled
);
export const API_HEARTBEAT_STATE_TIMEOUT_SECONDS = intVar(
	'API_HEARTBEAT_STATE_TIMEOUT_SECONDS',
	15,
);
export const API_VPN_SERVICE_API_KEY = requiredVar('API_VPN_SERVICE_API_KEY');
export const VPN_CONNECT_PROXY_PORT = intVar('VPN_CONNECT_PROXY_PORT', 3128);
export const AUTH_RESINOS_REGISTRY_CODE = optionalVar(
	'AUTH_RESINOS_REGISTRY_CODE',
);
export const COOKIE_SESSION_SECRET = requiredVar('COOKIE_SESSION_SECRET');
export const CONTRACTS_PUBLIC_REPO_OWNER = optionalVar(
	'CONTRACTS_PUBLIC_REPO_OWNER',
	'balena-io',
);
export const CONTRACTS_PUBLIC_REPO_NAME = optionalVar(
	'CONTRACTS_PUBLIC_REPO_NAME',
	'contracts',
);
export const CONTRACTS_PUBLIC_REPO_BRANCH = optionalVar(
	'CONTRACTS_PUBLIC_REPO_BRANCH',
);
export const CONTRACTS_PRIVATE_REPO_OWNER = optionalVar(
	'CONTRACTS_PRIVATE_REPO_OWNER',
);
export const CONTRACTS_PRIVATE_REPO_NAME = optionalVar(
	'CONTRACTS_PRIVATE_REPO_NAME',
);
export const CONTRACTS_PRIVATE_REPO_BRANCH = optionalVar(
	'CONTRACTS_PRIVATE_REPO_BRANCH',
);
export const CONTRACTS_PRIVATE_REPO_TOKEN = optionalVar(
	'CONTRACTS_PRIVATE_REPO_TOKEN',
);
export const DB_POOL_SIZE = intVar('DB_POOL_SIZE', undefined);
export const DB_STATEMENT_TIMEOUT = intVar('DB_STATEMENT_TIMEOUT', 1 * MINUTES);
export const DB_QUERY_TIMEOUT = intVar(
	'DB_QUERY_TIMEOUT',
	DB_STATEMENT_TIMEOUT + 1 * SECONDS,
);
export const DELTA_HOST = requiredVar('DELTA_HOST');
export const FILES_HOST = optionalVar('FILES_HOST', '');
export const DEVICE_CONFIG_OPENVPN_CA = requiredVar('DEVICE_CONFIG_OPENVPN_CA');
export const DEVICE_CONFIG_OPENVPN_CONFIG = openVpnConfig.replace(
	'remote {{VPN_DETAILS}}',
	`remote ${requiredVar('VPN_HOST')} ${requiredVar('VPN_PORT')}`,
);
export const DEVICE_CONFIG_SSH_AUTHORIZED_KEYS = optionalVar(
	'DEVICE_CONFIG_SSH_AUTHORIZED_KEYS',
	'',
);
export const EXTERNAL_HTTP_TIMEOUT_MS = intVar(
	'EXTERNAL_HTTP_TIMEOUT_MS',
	25 * SECONDS,
);
export const IMAGE_STORAGE_BUCKET = requiredVar('IMAGE_STORAGE_BUCKET');
export const IMAGE_STORAGE_ENDPOINT = requiredVar('IMAGE_STORAGE_ENDPOINT');
export const IMAGE_STORAGE_PREFIX = requiredVar('IMAGE_STORAGE_PREFIX');
export const IMAGE_STORAGE_ACCESS_KEY = optionalVar('IMAGE_STORAGE_ACCESS_KEY');
export const IMAGE_STORAGE_SECRET_KEY = optionalVar('IMAGE_STORAGE_SECRET_KEY');
export const IMAGE_STORAGE_FORCE_PATH_STYLE = boolVar(
	'IMAGE_STORAGE_FORCE_PATH_STYLE',
	false,
);
export const JSON_WEB_TOKEN_EXPIRY_MINUTES = intVar(
	'JSON_WEB_TOKEN_EXPIRY_MINUTES',
);
export const JSON_WEB_TOKEN_SECRET = requiredVar('JSON_WEB_TOKEN_SECRET');
export const MIXPANEL_TOKEN = requiredVar('MIXPANEL_TOKEN');
export const NODE_ENV = optionalVar('NODE_ENV');
export const NODE_EXTRA_CA_CERTS = optionalVar('NODE_EXTRA_CA_CERTS');
export const RATE_LIMIT_FACTOR = intVar('RATE_LIMIT_FACTOR', 1);
export const RATE_LIMIT_MEMORY_BACKEND = optionalVar(
	'RATE_LIMIT_MEMORY_BACKEND',
);

// Split `${host}:${port}` pairs, with a fallback to separate `${prefix}_HOST`/`${prefix}_PORT` pairs
const splitHostPort = (prefix: string): [string, number] => {
	const [host, maybePort] = requiredVar(`${prefix}_HOST`).split(':');
	const port = checkInt(maybePort) ?? intVar(`${prefix}_PORT`);
	return [host, port];
};
const optionalSplitHostPort = <
	T extends string | undefined,
	U extends number | undefined,
>(
	prefix: string,
	defaultHost: T,
	defaultPort: U,
): [string | undefined | T, number | U] => {
	const [host, maybePort] = optionalVar(
		`${prefix}_HOST`,
		defaultHost ?? '',
	).split(':');
	const port = checkInt(maybePort) ?? intVar(`${prefix}_PORT`, defaultPort);
	return [host === '' ? undefined : host, port];
};
const [redisHost, redisPort] = splitHostPort('REDIS');
const [redisRoHost, redisRoPort] = optionalSplitHostPort(
	'REDIS_RO',
	redisHost,
	redisPort,
);
const [redisLogsHost, redisLogsPort] = optionalSplitHostPort(
	'REDIS_LOGS',
	undefined,
	undefined,
);

export const REDIS = {
	general: {
		host: redisHost,
		port: redisPort,
		roHost: redisRoHost,
		roPort: redisRoPort,
	},
	logs: {
		host: redisLogsHost ?? redisHost,
		port: redisLogsPort ?? redisPort,
		roHost: optionalVar('REDIS_LOGS_RO_HOST') ?? redisLogsHost ?? redisRoHost,
		roPort:
			intVar('REDIS_LOGS_RO_PORT', undefined) ?? redisLogsPort ?? redisRoPort,
	},
};
export const LOKI_HOST = optionalVar('LOKI_HOST');
export const LOKI_PORT = intVar('LOKI_PORT', 9095);
// control the percent of logs written to Loki while scaling up
export const LOKI_WRITE_PCT = intVar('LOKI_WRITE_PCT', 0);
export const REGISTRY2_HOST = requiredVar('REGISTRY2_HOST');
export const SENTRY_DSN = optionalVar('SENTRY_DSN');
export const SUPERUSER_EMAIL = optionalVar('SUPERUSER_EMAIL', '');
export const SUPERUSER_PASSWORD = optionalVar('SUPERUSER_PASSWORD', '');
export const TOKEN_AUTH_BUILDER_TOKEN = requiredVar('TOKEN_AUTH_BUILDER_TOKEN');
export const TOKEN_AUTH_CERT_ISSUER = requiredVar('TOKEN_AUTH_CERT_ISSUER');
export const TOKEN_AUTH_CERT_KEY = requiredVar('TOKEN_AUTH_CERT_KEY');
export const TOKEN_AUTH_CERT_KID = requiredVar('TOKEN_AUTH_CERT_KID');
export const TOKEN_AUTH_CERT_PUB = requiredVar('TOKEN_AUTH_CERT_PUB');
export const TOKEN_AUTH_JWT_ALGO = requiredVar('TOKEN_AUTH_JWT_ALGO');
export const VPN_HOST = requiredVar('VPN_HOST');
export const VPN_PORT = requiredVar('VPN_PORT');
export const VPN_SERVICE_API_KEY = requiredVar('VPN_SERVICE_API_KEY');
export const VPN_GUEST_API_KEY = optionalVar('VPN_GUEST_API_KEY');

export const DEFAULT_SUPERVISOR_POLL_INTERVAL = intVar(
	'DEFAULT_SUPERVISOR_POLL_INTERVAL',
	10 * MINUTES,
);

export const HIDE_UNVERSIONED_ENDPOINT = boolVar(
	'HIDE_UNVERSIONED_ENDPOINT',
	true,
);

export const METRICS_MAX_REPORT_INTERVAL_SECONDS = intVar(
	'METRICS_MAX_REPORT_INTERVAL_SECONDS',
	60,
);
export const DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS = intVar(
	'DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS',
	30,
);

// Cache timeouts
export const BUILD_PROPERTY_CACHE_TIMEOUT = intVar(
	'BUILD_PROPERTY_CACHE_TIMEOUT',
	10 * MINUTES,
);
export const BUILD_COMPRESSED_SIZE_CACHE_TIMEOUT = intVar(
	'BUILD_COMPRESSED_SIZE_CACHE_TIMEOUT',
	20 * MINUTES,
);
export const DEVICE_EXISTS_CACHE_TIMEOUT = intVar(
	'DEVICE_EXISTS_CACHE_TIMEOUT',
	5 * MINUTES,
);
export const RESOLVE_IMAGE_ID_CACHE_TIMEOUT = intVar(
	'RESOLVE_IMAGE_ID_CACHE_TIMEOUT',
	5 * MINUTES,
);
export const RESOLVE_IMAGE_READ_ACCESS_CACHE_TIMEOUT = intVar(
	'RESOLVE_IMAGE_READ_ACCESS_CACHE_TIMEOUT',
	5 * MINUTES,
);
export const VPN_AUTH_CACHE_TIMEOUT = intVar(
	'VPN_AUTH_CACHE_TIMEOUT',
	5 * MINUTES,
);

const { TRUST_PROXY: trustProxy = 'true' } = process.env;
let trustProxyValue;
if (trustProxy === 'true') {
	// If it's 'true' enable it
	trustProxyValue = true;
} else if (trustProxy.includes('.') || trustProxy.includes(':')) {
	// If it looks like an ip use as-is
	trustProxyValue = trustProxy;
} else {
	const trustProxyNum = parseInt(trustProxy, 10);
	if (Number.isFinite(trustProxyNum)) {
		// If it's a number use the number
		trustProxyValue = trustProxyNum;
	} else {
		throw new Error(`Invalid value for 'TRUST_PROXY' of '${trustProxy}'`);
	}
}
export const TRUST_PROXY = trustProxyValue;

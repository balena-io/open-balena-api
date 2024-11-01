import type { HostPort } from '@balena/env-parsing';
import {
	boolVar,
	HOURS,
	intVar,
	MINUTES,
	optionalVar,
	requiredVar,
	SECONDS,
	hostPortsVar,
	trustProxyVar,
	arrayVar,
} from '@balena/env-parsing';

// Even though we only use these when TRUST_PROXY we do not conditionally
// import them, since that makes the execution order harder to predict.
import proxyAddr from 'proxy-addr';
import memoizee from 'memoizee';

export let version: string;
export function setVersion(v: typeof version) {
	if (version !== undefined) {
		throw new Error(
			`Can only set version once, trying to replace '${version}' with '${v}'`,
		);
	}
	version = v;
}

const openVpnConfig = `
client
{{VPN_DETAILS}}
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

export enum ADVISORY_LOCK_NAMESPACES {
	release__revision__belongs_to__application = 1,
}

export const API_HOST = requiredVar('API_HOST');
export const PORT = intVar('PORT', 1337);
export const API_HEARTBEAT_STATE_ENABLED = intVar(
	'API_HEARTBEAT_STATE_ENABLED',
	1, // 1 = enabled, 0 = disabled
);
export let API_HEARTBEAT_STATE_TIMEOUT_SECONDS = intVar(
	'API_HEARTBEAT_STATE_TIMEOUT_SECONDS',
	15,
);
/**
 * null:do not update the DB's device heartbeat to Online, if Redis says it's already Online
 * 0: always run DB device heartbeat updates to Online
 * >0: always persist an Online device heartbeat to the DB after N ms, even if the write cache is already Online.
 *   ie: only use the Redis write cache Online-ness for up to N ms and skip updating the DB to Online during that period.
 */
export let API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT = intVar(
	'API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT',
	null,
);
export const API_VPN_SERVICE_API_KEY = requiredVar('API_VPN_SERVICE_API_KEY');
export const VPN_CONNECT_PROXY_PORT = intVar('VPN_CONNECT_PROXY_PORT', 3128);

export let ASYNC_TASKS_ENABLED = boolVar('ASYNC_TASKS_ENABLED', false);

export const AUTH_RESINOS_REGISTRY_CODE = optionalVar(
	'AUTH_RESINOS_REGISTRY_CODE',
);
export const COOKIE_SESSION_SECRET = requiredVar('COOKIE_SESSION_SECRET');

/**
 * null: include all device type and device contract slugs
 * "x;y;z": include only the specified device type and contract slugs - note that you MUST list
 *          all dependent slugs as well so for hw.device-type/asus-tinker-board-s you would need:
 *          `arch.sw/armv7hf;hw.device-manufacturer/asus;hw.device-family/tinkerboard;hw.device-type/asus-tinker-board-s`
 * 		    For something like hw.device-type/iot-gate-imx8 you would need:
 * 			`arch.sw/aarch64;hw.device-type/iot-gate-imx8`
 *          (the order of the slugs in this variable does not matter)
 */
export const CONTRACT_ALLOWLIST = new Set(
	optionalVar('CONTRACT_ALLOWLIST', '')
		.split(';')
		.map((slug) => slug.trim())
		.filter((slug) => slug.length > 0),
);

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
export const VPN_UDP_HOST = optionalVar('VPN_UDP_HOST');
export const VPN_HOST = requiredVar('VPN_HOST');
export const VPN_PORT = requiredVar('VPN_PORT');

export const DEVICE_CONFIG_OPENVPN_CONFIG = (() => {
	if (VPN_UDP_HOST) {
		const remotes = [
			`remote ${VPN_UDP_HOST} ${VPN_PORT} udp`,
			`remote ${VPN_HOST} ${VPN_PORT} tcp`,
		].join('\n');
		return openVpnConfig
			.replace('{{VPN_DETAILS}}', remotes)
			.replace('\nproto tcp\n', '\n');
	} else {
		return openVpnConfig.replace(
			'{{VPN_DETAILS}}',
			`remote ${VPN_HOST} ${VPN_PORT}`,
		);
	}
})();

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
export const IMAGE_STORAGE_PREFIX = optionalVar(
	'IMAGE_STORAGE_PREFIX',
	'images',
);
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
export const JSON_WEB_TOKEN_LIMIT_EXPIRY_REFRESH = boolVar(
	'JSON_WEB_TOKEN_LIMIT_EXPIRY_REFRESH',
	false,
);
export const LOGS_HOST = optionalVar('LOGS_HOST');
export const MIXPANEL_TOKEN = requiredVar('MIXPANEL_TOKEN');
export const NODE_ENV = optionalVar('NODE_ENV');
export const NODE_EXTRA_CA_CERTS = optionalVar('NODE_EXTRA_CA_CERTS');
export const RATE_LIMIT_FACTOR = intVar('RATE_LIMIT_FACTOR', 1);
export const RATE_LIMIT_MEMORY_BACKEND = optionalVar(
	'RATE_LIMIT_MEMORY_BACKEND',
);

type RedisAuth = {
	username?: string;
	password?: string;
};

type RedisOpts =
	| {
			isCluster: true;
			hosts: HostPort[];
			auth: RedisAuth;
	  }
	| {
			isCluster: false;
			host: HostPort;
			auth: RedisAuth;
			roHost: HostPort;
			roAuth: RedisAuth;
	  };
function redisOpts(prefix: string): RedisOpts;
function redisOpts(
	prefix: string,
	defaultHosts: HostPort[],
	defaultAuth: RedisAuth,
	defaultIsCluster: boolean,
): RedisOpts;
function redisOpts(
	prefix: string,
	defaultHosts?: HostPort[],
	defaultAuth?: RedisAuth,
	defaultIsCluster?: boolean,
): RedisOpts {
	const hostVarName = `${prefix}_HOST`;
	const authVarName = `${prefix}_AUTH`;
	const roHostVarName = `${prefix}_RO_HOST`;
	const roAuthVarName = `${prefix}_RO_AUTH`;
	const isCluster = boolVar(`${prefix}_IS_CLUSTER`, defaultIsCluster);
	const hosts = hostPortsVar(hostVarName, defaultHosts);
	const auth = redisAuthVar(authVarName, defaultAuth);
	if (isCluster == null) {
		throw new Error(`Missing env: '${prefix}_IS_CLUSTER'`);
	}
	if (isCluster) {
		const varsIncompatibleWithClusterMode = [roHostVarName, roAuthVarName];
		for (const varName of varsIncompatibleWithClusterMode) {
			if (optionalVar(varName) != null) {
				throw new Error(`'${varName}' must be empty when in cluster mode `);
			}
		}
		return {
			isCluster,
			hosts,
			auth,
		};
	}
	if (hosts.length > 1) {
		throw new Error(
			`'${hostVarName}' must contain only one entry when not in cluster mode`,
		);
	}
	const roHosts = hostPortsVar(roHostVarName, hosts);
	if (roHosts.length > 1) {
		throw new Error(`'${roHostVarName}' must contain at most one entry`);
	}
	const roAuth = redisAuthVar(roAuthVarName, auth);
	return {
		isCluster,
		host: hosts[0],
		auth,
		roHost: roHosts[0],
		roAuth,
	};
}
const generalRedis = redisOpts('REDIS');

if (generalRedis.isCluster) {
	// TODO: This is due to RSMQ
	throw new Error(
		'Cluster mode is not supported for the general redis instance',
	);
}

export const REDIS = {
	general: generalRedis,
	logs: redisOpts(
		'REDIS_LOGS',
		[generalRedis.host],
		generalRedis.auth,
		generalRedis.isCluster,
	),
};
export const REDIS_LOGS_SHARDED_PUBSUB = boolVar(
	'REDIS_LOGS_SHARDED_PUBSUB',
	false,
);
export const REDIS_LOGS_COMPRESSION_ENABLED = boolVar(
	'REDIS_LOGS_COMPRESSION_ENABLED',
	true,
);
const LOKI_HOST = optionalVar('LOKI_HOST');
export const LOKI_INGESTER_HOST = optionalVar('LOKI_INGESTER_HOST', LOKI_HOST);
export const LOKI_QUERY_HOST = optionalVar('LOKI_QUERY_HOST', LOKI_HOST);
export const LOKI_INGESTER_GRPC_PORT = intVar('LOKI_INGESTER_GRPC_PORT', 9095);
export const LOKI_QUERY_HTTP_PORT = intVar('LOKI_QUERY_HTTP_PORT', 3100);
export const LOKI_HISTORY_GZIP = boolVar('LOKI_HISTORY_GZIP', true);
export const LOKI_GRPC_SEND_GZIP = boolVar('LOKI_GRPC_SEND_GZIP', true);
export const LOKI_GRPC_RECEIVE_COMPRESSION_LEVEL = intVar(
	'LOKI_GRPC_RECEIVE_COMPRESSION_LEVEL',
	2,
);
// control the percent of logs written to Loki while scaling up
export const LOKI_WRITE_PCT = intVar('LOKI_WRITE_PCT', 0);
/**
 * This is the percent of log read requests that will go to loki, however the number of logs fetched from loki
 * will vary based upon the type of those read requests, eg it could be a long streaming request or a one-off fetch
 */
export const LOKI_READ_PCT = intVar('LOKI_READ_PCT', 0);
if (LOKI_WRITE_PCT < 100 && LOKI_READ_PCT > 0) {
	throw new Error('LOKI_READ_PCT can only be set if LOKI_WRITE_PCT is 100');
}

export const NDJSON_CTYPE = 'application/x-ndjson';

// Logs read config
export const LOGS_HEARTBEAT_INTERVAL = 58000;
export const LOGS_DEFAULT_HISTORY_COUNT = 1000;
export const LOGS_DEFAULT_SUBSCRIPTION_COUNT = 0;
export const LOGS_SUBSCRIPTION_EXPIRY_SECONDS = 60 * 60;
export const LOGS_SUBSCRIPTION_EXPIRY_HEARTBEAT_SECONDS =
	LOGS_SUBSCRIPTION_EXPIRY_SECONDS / 2;

export const LOGS_DEFAULT_RETENTION_LIMIT = 1000;

// Logs read config
export const LOGS_READ_STREAM_FLUSH_INTERVAL = intVar(
	'LOGS_READ_STREAM_FLUSH_INTERVAL',
	500,
);

// Logs write config
export const LOGS_STREAM_FLUSH_INTERVAL = intVar(
	'LOGS_STREAM_FLUSH_INTERVAL',
	500,
);
export const LOGS_BACKEND_UNAVAILABLE_FLUSH_INTERVAL = intVar(
	'LOGS_BACKEND_UNAVAILABLE_FLUSH_INTERVAL',
	5000,
);
export const LOGS_WRITE_BUFFER_LIMIT = intVar('LOGS_WRITE_BUFFER_LIMIT', 50);

export const PINEJS_QUEUE_CONCURRENCY = intVar('PINEJS_QUEUE_CONCURRENCY', 1);
export let PINEJS_QUEUE_INTERVAL_MS = intVar('PINEJS_QUEUE_INTERVAL_MS', 1000);

export const ASYNC_TASK_ATTEMPT_LIMIT = intVar(
	'ASYNC_TASK_ATTEMPT_LIMIT',
	2 ** 31 - 1,
);
export let ASYNC_TASK_CREATE_SERVICE_INSTALLS_ENABLED = boolVar(
	'ASYNC_TASK_CREATE_SERVICE_INSTALLS_ENABLED',
	false,
);
export const ASYNC_TASK_CREATE_SERVICE_INSTALLS_BATCH_SIZE = intVar(
	'ASYNC_TASK_CREATE_SERVICE_INSTALLS_BATCH_SIZE',
	2000,
);
export const ASYNC_TASK_CREATE_SERVICE_INSTALLS_MAX_TIME_MS = intVar(
	'ASYNC_TASK_CREATE_SERVICE_INSTALLS_MAX_TIME_MS',
	30 * 1000,
);

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
export const VPN_SERVICE_API_KEY = requiredVar('VPN_SERVICE_API_KEY');
export const VPN_GUEST_API_KEY = optionalVar('VPN_GUEST_API_KEY');

export let DEFAULT_SUPERVISOR_POLL_INTERVAL = intVar(
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
// Maximum integer value for metrics, default to max value for postgres
export const METRICS_MAX_INTEGER_VALUE = intVar(
	'METRICS_MAX_INTEGER_VALUE',
	2 ** 31 - 1,
);
export const DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS = intVar(
	'DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS',
	30,
);
/**
 * The time between the end of an empty state get and the start of the next
 */
export const EMPTY_DEVICE_STATE_GET_DELAY_SECONDS = intVar(
	'EMPTY_DEVICE_STATE_GET_DELAY_SECONDS',
	// Default to the default state poll interval so that an empty request only repeats
	// at the same rate as standard polling
	// DEFAULT_SUPERVISOR_POLL_INTERVAL is in ms, so we need to divide by 1000
	DEFAULT_SUPERVISOR_POLL_INTERVAL / SECONDS,
);

// Cache timeouts
export const IMAGE_INSTALL_CACHE_TIMEOUT_SECONDS = intVar(
	'IMAGE_INSTALL_CACHE_TIMEOUT_SECONDS',
	Math.max(DOWNLOAD_PROGRESS_MAX_REPORT_INTERVAL_SECONDS, 5 * 60),
);
export const DEVICE_TYPES_CACHE_LOCAL_TIMEOUT = intVar(
	'DEVICE_TYPES_CACHE_LOCAL_TIMEOUT',
	5 * MINUTES,
);
export const DEVICE_TYPES_CACHE_TIMEOUT = intVar(
	'DEVICE_TYPES_CACHE_TIMEOUT',
	1 * HOURS,
);
export const BUILD_PROPERTY_CACHE_TIMEOUT = intVar(
	'BUILD_PROPERTY_CACHE_TIMEOUT',
	10 * MINUTES,
);
export const BUILD_COMPRESSED_SIZE_CACHE_TIMEOUT = intVar(
	'BUILD_COMPRESSED_SIZE_CACHE_TIMEOUT',
	20 * MINUTES,
);
export const API_KEY_EXISTS_CACHE_TIMEOUT = intVar(
	'API_KEY_EXISTS_CACHE_TIMEOUT',
	5 * MINUTES,
);
export const DEVICE_EXISTS_CACHE_TIMEOUT = intVar(
	'DEVICE_EXISTS_CACHE_TIMEOUT',
	5 * MINUTES,
);
export const GET_SUBJECT_CACHE_TIMEOUT = 5 * MINUTES;
export const RESOLVE_IMAGE_ID_CACHE_TIMEOUT = intVar(
	'RESOLVE_IMAGE_ID_CACHE_TIMEOUT',
	5 * MINUTES,
);
export const RESOLVE_IMAGE_LOCATION_CACHE_TIMEOUT = intVar(
	'RESOLVE_IMAGE_LOCATION_CACHE_TIMEOUT',
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
export const DEVICE_LOGS_WRITE_AUTH_CACHE_TIMEOUT = intVar(
	'DEVICE_LOGS_WRITE_AUTH_CACHE_TIMEOUT',
	5 * MINUTES,
);
export const API_KEY_ROLE_CACHE_TIMEOUT = intVar(
	'API_KEY_ROLE_CACHE_TIMEOUT',
	5 * MINUTES,
);

export const GZIP_COMPRESSION_QUALITY = intVar('GZIP_COMPRESSION_QUALITY', -1);
export const BROTLI_COMPRESSION_QUALITY = intVar(
	'BROTLI_COMPRESSION_QUALITY',
	4,
);
export const BROTLI_COMPRESSION_WINDOW_BITS = intVar(
	'BROTLI_COMPRESSION_WINDOW_BITS',
	undefined,
);

const trustProxy = trustProxyVar('TRUST_PROXY', false);

let trustProxyValue:
	| Exclude<typeof trustProxy, string>
	| ReturnType<typeof import('proxy-addr').compile>;
if (typeof trustProxy === 'string') {
	// If trust proxy is a string then compile the trust function directly and memoize it, since the trust
	// function is fairly expensive for such a hot function and if we trust some ips then it's likely
	// that the majority of trust proxy calls will be coming from those ips - 50% if there's one level
	// of proxy/load balancing and increasing if there are more levels of proxies/load balancers

	// Support comma-separated IPs
	const trustProxyIPs = trustProxy.split(/ *, */);
	trustProxyValue = memoizee(proxyAddr.compile(trustProxyIPs), {
		primitive: true,
		max: 1000,
	});
} else {
	trustProxyValue = trustProxy;
}
export const TRUST_PROXY = trustProxyValue;

export const IGNORE_FROZEN_DEVICE_PERMISSIONS = boolVar(
	'IGNORE_FROZEN_DEVICE_PERMISSIONS',
	false,
);

export const WEBRESOURCES_S3_HOST = optionalVar('WEBRESOURCES_S3_HOST');
export const WEBRESOURCES_S3_REGION = optionalVar('WEBRESOURCES_S3_REGION');
export const WEBRESOURCES_S3_ACCESS_KEY = optionalVar(
	'WEBRESOURCES_S3_ACCESS_KEY',
);
export const WEBRESOURCES_S3_SECRET_KEY = optionalVar(
	'WEBRESOURCES_S3_SECRET_KEY',
);
export const WEBRESOURCES_S3_BUCKET = optionalVar('WEBRESOURCES_S3_BUCKET');
export const WEBRESOURCES_S3_MAX_FILESIZE = intVar(
	'WEBRESOURCES_S3_MAX_FILESIZE',
	500000000,
);
export const WEBRESOURCES_CLOUDFRONT_PRIVATEKEY_PATH = optionalVar(
	'WEBRESOURCES_CLOUDFRONT_PRIVATEKEY_PATH',
);
export const WEBRESOURCES_CLOUDFRONT_PUBLICKEY = optionalVar(
	'WEBRESOURCES_CLOUDFRONT_PUBLICKEY',
);
export const WEBRESOURCES_CLOUDFRONT_HOST = optionalVar(
	'WEBRESOURCES_CLOUDFRONT_HOST',
);

export const DISABLED_SCHEDULED_JOBS = new Set(
	arrayVar('DISABLED_SCHEDULED_JOBS') ?? [],
);
export const disableScheduledJob = (jobName: string) => {
	DISABLED_SCHEDULED_JOBS.add(jobName);
};
export const enableScheduledJob = (jobName: string) => {
	DISABLED_SCHEDULED_JOBS.delete(jobName);
};

/**
 * Splits an env var in the format of `${username}:${password}`
 * into a RedisAuth object. Auth is optional, so this can return
 * an empty RedisAuth object.
 */
function redisAuthVar(
	varName: string | string[],
	defaultAuth?: RedisAuth,
): RedisAuth {
	const authPair = optionalVar(varName);
	if (authPair == null) {
		if (defaultAuth == null) {
			return {};
		}
		return defaultAuth;
	}

	// Valid auth is of the form `${username}:${password}`, `${password}`, `:${password}`, or `${username}:`
	const parts = authPair.trim().split(':');
	switch (parts.length) {
		case 1:
			return {
				password: parts[0],
			};
		case 2:
			return {
				username: parts[0],
				password: parts[1],
			};
	}

	throw new Error(
		`'${varName}' must be in one of the following forms 'username:password', 'password', ':password', or 'username:'`,
	);
}

export const guardTestMockOnly = () => {
	if (process.env.DEPLOYMENT !== 'TEST') {
		throw new Error('Attempting to use TEST_MOCK_ONLY outside of tests');
	}
};
export const TEST_MOCK_ONLY = {
	set DEFAULT_SUPERVISOR_POLL_INTERVAL(
		v: typeof DEFAULT_SUPERVISOR_POLL_INTERVAL,
	) {
		guardTestMockOnly();
		DEFAULT_SUPERVISOR_POLL_INTERVAL = v;
	},
	set API_HEARTBEAT_STATE_TIMEOUT_SECONDS(
		v: typeof API_HEARTBEAT_STATE_TIMEOUT_SECONDS,
	) {
		guardTestMockOnly();
		API_HEARTBEAT_STATE_TIMEOUT_SECONDS = v;
	},
	set API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT(
		v: typeof API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT,
	) {
		guardTestMockOnly();
		API_HEARTBEAT_STATE_ONLINE_UPDATE_CACHE_TIMEOUT = v;
	},
	set ASYNC_TASKS_ENABLED(v: typeof ASYNC_TASKS_ENABLED) {
		guardTestMockOnly();
		ASYNC_TASKS_ENABLED = v;
	},
	set ASYNC_TASK_CREATE_SERVICE_INSTALLS_ENABLED(
		v: typeof ASYNC_TASK_CREATE_SERVICE_INSTALLS_ENABLED,
	) {
		guardTestMockOnly();
		ASYNC_TASK_CREATE_SERVICE_INSTALLS_ENABLED = v;
	},
	set PINEJS_QUEUE_INTERVAL_MS(v: typeof PINEJS_QUEUE_INTERVAL_MS) {
		guardTestMockOnly();
		PINEJS_QUEUE_INTERVAL_MS = v;
	},
};

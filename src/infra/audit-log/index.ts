import type { Request } from 'express';
import {
	LokiAuditLogClient,
	type BalenaAuditLogClient,
} from '@balena/audit-log-client';
import {
	AUDIT_LOGS_ENABLED,
	AUDIT_LOGS_LOKI_GATEWAY_HOST,
	AUDIT_LOGS_LOKI_GATEWAY_PORT,
	AUDIT_LOGS_LOKI_AUTH_USER,
	AUDIT_LOGS_LOKI_AUTH_PASSWORD,
	AUDIT_LOGS_ON_ERROR,
} from '../../lib/config.js';
import { getIP } from '../../lib/utils.js';

export const getRequestMetadata = (req: Request): Record<string, string> => {
	const metadata: Record<string, string> = {};
	const ip = getIP(req);
	if (ip != null) {
		metadata.ip = ip;
	}
	return metadata;
};

export const auditLogClient: BalenaAuditLogClient | undefined = (() => {
	if (!AUDIT_LOGS_ENABLED || AUDIT_LOGS_LOKI_GATEWAY_HOST == null) {
		return undefined;
	}

	const basicAuth =
		AUDIT_LOGS_LOKI_AUTH_USER != null && AUDIT_LOGS_LOKI_AUTH_PASSWORD != null
			? {
					username: AUDIT_LOGS_LOKI_AUTH_USER,
					password: AUDIT_LOGS_LOKI_AUTH_PASSWORD,
				}
			: undefined;

	return new LokiAuditLogClient({
		lokiIngesterHost: AUDIT_LOGS_LOKI_GATEWAY_HOST,
		lokiIngesterPort: AUDIT_LOGS_LOKI_GATEWAY_PORT,
		lokiQueryHost: AUDIT_LOGS_LOKI_GATEWAY_HOST,
		lokiQueryPort: AUDIT_LOGS_LOKI_GATEWAY_PORT,
		onIngestionError: AUDIT_LOGS_ON_ERROR,
		serviceName: 'balena-api',
		basicAuth,
	});
})();

export type { BalenaAuditLogClient };

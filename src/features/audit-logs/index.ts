import { AUDIT_LOG_LOKI_INGESTER_HOST, AUDIT_LOG_LOKI_INGESTER_PORT, AUDIT_LOG_LOKI_QUERY_HOST, AUDIT_LOG_LOKI_QUERY_PORT } from "../../lib/config.js";
import { LokiAuditLogClient } from "./lib/client/backends/LokiAuditLogClient.js";
import { BalenaAuditLogClient } from "./lib/client/index.js";

let auditLogClient: BalenaAuditLogClient;

export const getAuditLogClient = (): BalenaAuditLogClient => {
	auditLogClient ??= new LokiAuditLogClient({
		lokiIngestorHost: AUDIT_LOG_LOKI_INGESTER_HOST!,
		lokiIngestorPort: AUDIT_LOG_LOKI_INGESTER_PORT,
		lokiQueryHost: AUDIT_LOG_LOKI_QUERY_HOST!,
		lokiQueryPort: AUDIT_LOG_LOKI_QUERY_PORT,
		serviceName: 'balena-api'
	});
	return auditLogClient;
}

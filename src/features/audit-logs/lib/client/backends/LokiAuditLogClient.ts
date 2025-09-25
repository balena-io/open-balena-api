import type { BalenaAuditLogClient } from '../index.js';
import type {
	QueryPayload,
	BalenaOrgEvent,
	BalenaUserEvent,
} from '../index.js';
import { AUDIT_LOG_QUERY_TIMEOUT } from '../../../../../lib/config.js';

interface LokiOptions {
	lokiIngestorHost: string;
	lokiIngestorPort: number;
	lokiQueryHost: string;
	lokiQueryPort: number;
	serviceName: string;
}

interface LokiFilters {
	start: Date;
	end: Date;
	selectors: string;
	limit?: number;
	direction: 'backward' | 'forward';
}

type LokiLabels = Record<string, string>;
type LokiStructuredMetadata = Record<string, string>;

interface LokiStream {
	stream: LokiLabels;
	values: Array<[string, string, LokiStructuredMetadata?]>;
}

interface LokiPushRequest {
	streams: LokiStream[];
}

type SingleResourceOrgEvent = Omit<BalenaOrgEvent, 'resource'> & { resource: string };

export class LokiAuditLogClient implements BalenaAuditLogClient {
	private serviceName: string;
	private lokiIngestorAddress: string;
	private lokiQueryAddress: string;

	constructor(config: LokiOptions) {
		this.serviceName = config.serviceName;
		this.lokiIngestorAddress = `${config.lokiIngestorHost}:${config.lokiIngestorPort}`;
		this.lokiQueryAddress = `${config.lokiQueryHost}:${config.lokiQueryPort}`;
	}

	private async push(
		tenantId: string,
		payload: BalenaUserEvent | BalenaOrgEvent,
	): Promise<void> {
		// we probably do not want to abuse labels as loki was not meant to deal with the high cardinality/indexing
		// see: https://grafana.com/docs/loki/latest/get-started/labels/bp-labels/
		// TODO: what other labels we might want?
		// Maybe we want a level? like error, debug etc for categorizing different types of events?
		// or even result as success/failure (altough this is trickier)
		// maybe resource_type for fixed things like `device`, `application` etc could make sense here
		// This needs product input
		const labels = {
			job: 'auditlogs',
			service: this.serviceName,
		};

		// When using structured metadata, each unique combination of metadata requires a separate stream
		// So for multiple resources, we need multiple streams
		const streams = this.createStreams(payload, labels);

		const pushRequest: LokiPushRequest = {
			streams
		};

		const response = await fetch(
			`http://${this.lokiIngestorAddress}/loki/api/v1/push`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Scope-OrgID': tenantId,
				},
				body: JSON.stringify(pushRequest),
			}
		);

		if (!response.ok) {
			const body = await response.text();
			throw new Error(`Audit log push failed: statusCode=${response.status}, body=${body}`);
		}
	}

	private createStreams(payload: BalenaUserEvent | BalenaOrgEvent, labels: Record<string, string>): LokiStream[] {
		if (!('resource' in payload) || !Array.isArray(payload.resource)) {
			const timestamp = this.getTimestampNanos();
			const value = this.buildValue(payload as BalenaUserEvent | SingleResourceOrgEvent, timestamp);
			return [{
				stream: labels,
				values: [value]
			}];
		}

		return payload.resource.map((singleResource, index) => {
			// This offset is necessary as if nanos are the same (which happens as Date does not have enough precision)
			// Loki will dedupe  thinking that this is a duplicated entry and remove it
			const timestamp = this.getTimestampNanos(index);
			const value = this.buildValue({ ...payload, resource: singleResource }, timestamp);
			return {
				stream: labels,
				values: [value]
			};
		});
	}

	private getTimestampNanos(offset = 0): string {
		const now = Date.now();
		const seconds = Math.floor(now / 1000);
		const nanos = (now % 1000) * 1000000 + offset;
		return `${seconds}${nanos.toString().padStart(9, '0')}`;
	}


	private buildValue(payload: BalenaUserEvent | SingleResourceOrgEvent, timestamp: string): [string, string, Record<string, string>?] {
		const metadata = this.buildStructuredMetadata(payload);

		const line: AnyObject = { metadata: payload.metadata };
		if ('organizationId' in payload) {
			line.organizationId = payload.organizationId;
		}
		if ('userId' in payload) {
			line.userId = payload.userId;
		}

		// Return as tuple: [timestamp, logline, structured_metadata]
		return [timestamp, JSON.stringify(line), metadata];
	}

	private buildStructuredMetadata(payload: BalenaUserEvent | SingleResourceOrgEvent): Record<string, string> {
		const metadata: Record<string, string> = {
			action: payload.action,
			actorId: `${payload.actorId}`,
			actorDisplayName: `${payload.actorDisplayName}`,
		};

		if ('resource' in payload) {
			metadata.resource = `${payload.resource}`;
		}

		return metadata;
	}

	private async queryRange(
		tenantIds: string[],
		lokiFilters: LokiFilters,
	): Promise<Array<(BalenaUserEvent | BalenaOrgEvent) & { timestamp: string }>> {
		// See: https://grafana.com/docs/loki/latest/operations/multi-tenancy/#multi-tenant-queries
		const tenants = tenantIds.join('|');

		// IMPORTANT: We use the rest client instead of the gRPC client for querying because
		// the GRPc client requires using ruler we can't use it to query for multi-tenant queries
		// See: https://github.com/grafana/loki/issues/7659
		const params = new URLSearchParams({
			query: lokiFilters.selectors,
			limit: (lokiFilters.limit || 1000).toString(),
			start: `${lokiFilters.start.getTime() * 1000000}`,
			end: `${lokiFilters.end.getTime() * 1000000}`,
			direction: lokiFilters.direction,
		});

		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), AUDIT_LOG_QUERY_TIMEOUT);

		try {
			const response = await fetch(
				`http://${this.lokiQueryAddress}/loki/api/v1/query_range?${params}`,
				{
					method: 'GET',
					headers: {
						'X-Scope-OrgID': tenants,
						'Accept-Encoding': 'gzip',
					},
					signal: controller.signal,
				}
			);

			clearTimeout(timeoutId);

			const body = await response.json();

			if (!response.ok) {
				throw new Error(
					`Failed to fetch loki audit logs, statusCode=${response.status}, body=${JSON.stringify(body)}`,
				);
			}

			const results: Array<(BalenaUserEvent | BalenaOrgEvent) & { timestamp: string }> = [];

			if (body.data?.result) {
				for (const result of body.data.result as Array<{
					stream: AnyObject, values: Array<[timestamp: string, logLine: string]>;
				}>) {
					// Iterate through all values, not just the first one
					for (const [timestamp, logLine] of result.values) {
						const response = {
							timestamp,
							...JSON.parse(logLine),
							action: result.stream.action,
							actorDisplayName: result.stream.actorDisplayName,
							actorId: parseInt(result.stream.actorId, 10),
							resource: result.stream.resource,
						};
						results.push(response);
					}
				}
			}

			return results;
		} catch (error: any) {
			if (error.name === 'AbortError') {
				throw new Error('Request timeout after 30 seconds');
			}
			throw error;
		}
	}

	public async logUserEvent(userEvent: BalenaUserEvent): Promise<void> {
		await this.push(`user-${userEvent.userId}`, userEvent);
	}

	public async logOrgEvent(orgEvent: BalenaOrgEvent): Promise<void> {
		await this.push(`org-${orgEvent.organizationId}`, orgEvent);
	}

	public async query(
		query: QueryPayload,
	): Promise<Array<(BalenaUserEvent | BalenaOrgEvent) & { timestamp: string }>> {
		const tenantIds: string[] = [];

		if ('userId' in query && query.userId !== undefined) {
			tenantIds.push(`user-${query.userId}`);
		}

		if ('orgId' in query && query.orgId !== undefined) {
			const orgIds = Array.isArray(query.orgId) ? query.orgId : [query.orgId];
			orgIds.forEach((id) => tenantIds.push(`org-${id}`));
		}

		// TODO: if we use structured metadata (and bloom filters) it is important to move the JSON parsing
		// At the END of the selector as this will enable bloom filters to kick in
		const selectors: string[] = ['{job="auditlogs"}'];
		if (query.actorId) {
			selectors.push(`actorId="${query.actorId}"`);
		}
		if (query.action) {
			selectors.push(`action="${query.action}"`);
		}
		if (query.resource) {
			selectors.push(`resource="${query.resource}"`);
		}

		const lokiFilters: LokiFilters = {
			selectors: selectors.join(' | '),
			start: new Date(query.start),
			end: new Date(query.end),
			limit: query.limit,
			direction: query.direction ?? 'backward',
		};

		return await this.queryRange(tenantIds, lokiFilters);
	}
}

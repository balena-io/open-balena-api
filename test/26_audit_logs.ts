import { expect } from 'chai';
import type { BalenaUserEvent, BalenaOrgEvent } from '../src/features/audit-logs/lib/client/index.js';
import { LokiAuditLogClient } from '../src/features/audit-logs/lib/client/backends/LokiAuditLogClient.js';

const expectUserEvent = (event: BalenaUserEvent | BalenaOrgEvent): BalenaUserEvent => {
	if (!('userId' in event)) {
		throw new Error('Expected user event but got organization event');
	}
	return event;
};

const expectOrgEvent = (event: BalenaUserEvent | BalenaOrgEvent): BalenaOrgEvent => {
	if (!('organizationId' in event)) {
		throw new Error('Expected organization event but got user event');
	}
	expect('organizationId' in event).to.be.true;
	return event;
};

export default () => {
	describe('Audit Logs', () => {
		let auditLogClient: LokiAuditLogClient;

		beforeEach(() => {
			auditLogClient = new LokiAuditLogClient({
				lokiIngestorHost: process.env.AUDIT_LOG_LOKI_INGESTER_HOST ?? 'loki',
				lokiIngestorPort: parseInt(
					process.env.AUDIT_LOG_LOKI_INGESTER_PORT ?? '3100',
					10,
				),
				lokiQueryHost: process.env.AUDIT_LOG_LOKI_QUERY_HOST ?? 'loki',
				lokiQueryPort: parseInt(
					process.env.AUDIT_LOG_LOKI_QUERY_PORT ?? '3100',
					10,
				),
				serviceName: 'test-api',
			});
		});

		it('should push a user audit log and retrieve it', async () => {
			const userAction: BalenaUserEvent = {
				action: 'user_login',
				actorId: 123,
				actorDisplayName: 'Test User',
				userId: 456,
				metadata: {
					ip: '192.168.1.1',
					userAgent: 'Mozilla/5.0',
				},
			};

			await auditLogClient.logUserEvent(userAction);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			const queryResult = await auditLogClient.query({
				userId: 456,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(queryResult).to.have.lengthOf(1);

			const result = queryResult[0];
			expect(result).to.have.property('timestamp');
			expect(result.action).to.equal('user_login');
			expect(result.actorId).to.equal(123);
			expect(result.actorDisplayName).to.equal('Test User');

			const userEvent = expectUserEvent(result);
			expect(userEvent.userId).to.equal(456);

			expect(result.metadata).to.deep.equal({
				ip: '192.168.1.1',
				userAgent: 'Mozilla/5.0',
			});
		});

		it('should filter by action type', async () => {
			const loginAction: BalenaUserEvent = {
				action: 'user_login',
				actorId: 123,
				actorDisplayName: 'Test User',
				userId: 456,
				metadata: { ip: '192.168.1.1' },
			};

			const logoutAction: BalenaUserEvent = {
				action: 'user_logout',
				actorId: 123,
				actorDisplayName: 'Test User',
				userId: 456,
				metadata: { ip: '192.168.1.1' },
			};

			await auditLogClient.logUserEvent(loginAction);
			await auditLogClient.logUserEvent(logoutAction);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			const queryResult = await auditLogClient.query({
				userId: 456,
				action: 'user_login',
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(queryResult).to.have.lengthOf.at.least(1);
			expect(queryResult.every(r => r.action === 'user_login')).to.be.true;
		});

		it('should filter by date range', async () => {
			const now = Date.now();
			const userAction: BalenaUserEvent = {
				action: 'user_login',
				actorId: 789,
				actorDisplayName: 'Date Test User',
				userId: 789,
				metadata: { test: 'date_range' },
			};

			await auditLogClient.logUserEvent(userAction);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Query with a narrow time window
			const queryResult = await auditLogClient.query({
				userId: 789,
				start: new Date(now - 5000).toISOString(),
				end: new Date(now + 5000).toISOString(),
			});

			expect(queryResult).to.have.lengthOf.at.least(1);
			const filtered = queryResult.filter(r => {
				try {
					const userEvent = expectUserEvent(r);
					return userEvent.userId === 789;
				} catch {
					return false;
				}
			});
			expect(filtered).to.have.lengthOf.at.least(1);

			// Query with time window that should exclude the event
			const emptyResult = await auditLogClient.query({
				userId: 789,
				start: new Date(now - 7200000).toISOString(),
				end: new Date(now - 3600000).toISOString(),
			});

			expect(emptyResult).to.have.lengthOf(0);
		});

		it('should filter by actorId', async () => {
			const event1: BalenaUserEvent = {
				action: 'user_login',
				actorId: 999,
				actorDisplayName: 'Actor 999',
				userId: 111,
				metadata: { test: 'actor_filter' },
			};

			const event2: BalenaUserEvent = {
				action: 'user_logout',
				actorId: 888,
				actorDisplayName: 'Actor 888',
				userId: 111,
				metadata: { test: 'actor_filter' },
			};

			await auditLogClient.logUserEvent(event1);
			await auditLogClient.logUserEvent(event2);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			const queryResult = await auditLogClient.query({
				userId: 111,
				actorId: 999,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(queryResult).to.have.lengthOf.at.least(1);
			expect(queryResult.every(r => r.actorId === 999)).to.be.true;
		});

		it('should retrieve multiple events in order', async () => {
			const userId = 222;
			const events: BalenaUserEvent[] = [];

			for (let i = 0; i < 3; i++) {
				events.push({
					action: 'user_login',
					actorId: 333,
					actorDisplayName: `Test User ${i}`,
					userId,
					metadata: { index: i },
				});
			}

			for (const event of events) {
				await auditLogClient.logUserEvent(event);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));

			const queryResult = await auditLogClient.query({
				userId,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(queryResult.length).to.be.at.least(3);

			const filteredResults = queryResult.filter(r => {
				try {
					const userEvent = expectUserEvent(r);
					return userEvent.userId === userId;
				} catch {
					return false;
				}
			});

			expect(filteredResults).to.have.lengthOf.at.least(3);
		});

		it('should push an organization audit log and retrieve it', async () => {
			const orgAction: BalenaOrgEvent = {
				action: 'org_member_added',
				actorId: 789,
				actorDisplayName: 'Admin User',
				organizationId: 1001,
				resource: 'organization',
				metadata: {
					memberEmail: 'new.member@example.com',
					role: 'developer',
				},
			};

			await auditLogClient.logOrgEvent(orgAction);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			const queryResult = await auditLogClient.query({
				orgId: 1001,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(queryResult).to.have.lengthOf(1);

			const result = queryResult[0];
			expect(result).to.have.property('timestamp');
			expect(result.action).to.equal('org_member_added');
			expect(result.actorId).to.equal(789);
			expect(result.actorDisplayName).to.equal('Admin User');

			const orgEvent = expectOrgEvent(result);
			expect(orgEvent.organizationId).to.equal(1001);
			expect(orgEvent.metadata).to.deep.equal({
				memberEmail: 'new.member@example.com',
				role: 'developer',
			});
		});

		it('should filter organization events by action type', async () => {
			const memberAddedAction: BalenaOrgEvent = {
				action: 'org_member_added',
				actorId: 555,
				actorDisplayName: 'Org Admin',
				organizationId: 2002,
				resource: 'organization',
				metadata: { member: 'user1@example.com' },
			};

			const memberRemovedAction: BalenaOrgEvent = {
				action: 'org_member_removed',
				actorId: 555,
				actorDisplayName: 'Org Admin',
				organizationId: 2002,
				resource: 'organization',
				metadata: { member: 'user2@example.com' },
			};

			await auditLogClient.logOrgEvent(memberAddedAction);
			await auditLogClient.logOrgEvent(memberRemovedAction);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			const queryResult = await auditLogClient.query({
				orgId: 2002,
				action: 'org_member_added',
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(queryResult).to.have.lengthOf.at.least(1);
			expect(queryResult.every(r => r.action === 'org_member_added')).to.be.true;
			queryResult.forEach(r => expectOrgEvent(r));
		});

		it('should query multiple organization IDs', async () => {
			const org1Event: BalenaOrgEvent = {
				action: 'org_settings_updated',
				actorId: 666,
				actorDisplayName: 'Admin 1',
				organizationId: 3001,
				resource: 'organization',
				metadata: { setting: 'billing' },
			};

			const org2Event: BalenaOrgEvent = {
				action: 'org_settings_updated',
				actorId: 777,
				actorDisplayName: 'Admin 2',
				organizationId: 3002,
				resource: 'organization',
				metadata: { setting: 'permissions' },
			};

			await auditLogClient.logOrgEvent(org1Event);
			await auditLogClient.logOrgEvent(org2Event);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			const queryResult = await auditLogClient.query({
				orgId: [3001, 3002],
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(queryResult).to.have.lengthOf.at.least(2);

			const orgIds = queryResult.map(r => {
				const orgEvent = expectOrgEvent(r);
				return orgEvent.organizationId;
			});

			expect(orgIds).to.include(3001);
			expect(orgIds).to.include(3002);
		});

		it('should respect the limit parameter', async () => {
			const userId = 8001;
			const events: BalenaUserEvent[] = [];

			// Create 10 events
			for (let i = 0; i < 10; i++) {
				events.push({
					action: 'user_login',
					actorId: 888,
					actorDisplayName: `Limit Test User ${i}`,
					userId,
					metadata: { index: i, test: 'limit_parameter' },
				});
			}

			// Log all events with small delays to ensure ordering
			for (const event of events) {
				await auditLogClient.logUserEvent(event);
				await new Promise((resolve) => setTimeout(resolve, 50));
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Query with limit of 5
			const limitedResult = await auditLogClient.query({
				userId,
				limit: 5,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(limitedResult).to.have.lengthOf(5);

			// Query without limit to verify all events were created
			const allResult = await auditLogClient.query({
				userId,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(allResult.length).to.be.at.least(10);
		});

		it('should respect the direction parameter', async () => {
			const userId = 9001;
			const events: BalenaUserEvent[] = [];

			// Create events with different timestamps
			for (let i = 0; i < 5; i++) {
				events.push({
					action: 'user_login',
					actorId: 999,
					actorDisplayName: `Direction Test User`,
					userId,
					metadata: { index: i, test: 'direction_parameter' },
				});
			}

			// Log events with delays to ensure different timestamps
			for (const event of events) {
				await auditLogClient.logUserEvent(event);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Query with backward direction (newest first)
			const backwardResult = await auditLogClient.query({
				userId,
				direction: 'backward',
				limit: 3,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			// Query with forward direction (oldest first)
			const forwardResult = await auditLogClient.query({
				userId,
				direction: 'forward',
				limit: 3,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(backwardResult).to.have.lengthOf(3);
			expect(forwardResult).to.have.lengthOf(3);

			// Verify that backward and forward give different orders
			// The first item in backward should have a higher index than first in forward
			const backwardFirstIndex = backwardResult[0].metadata?.index;
			const forwardFirstIndex = forwardResult[0].metadata?.index;

			expect(backwardFirstIndex).to.be.greaterThan(forwardFirstIndex);
		});

		it('should filter by resource parameter', async () => {
			const orgId = 10001;

			// Create different org events with different resources
			const deviceEvent: BalenaOrgEvent = {
				action: 'release_created',
				actorId: 1111,
				actorDisplayName: 'Resource Test Admin',
				organizationId: orgId,
				resource: 'device/123',
				metadata: { deviceName: 'test-device-1' },
			};

			const applicationEvent: BalenaOrgEvent = {
				action: 'org_application_created',
				actorId: 1111,
				actorDisplayName: 'Resource Test Admin',
				organizationId: orgId,
				resource: 'application/456',
				metadata: { appName: 'test-app-1' },
			};

			const anotherDeviceEvent: BalenaOrgEvent = {
				action: 'org_settings_updated',
				actorId: 1111,
				actorDisplayName: 'Resource Test Admin',
				organizationId: orgId,
				resource: 'device/789',
				metadata: { update: 'status' },
			};

			await auditLogClient.logOrgEvent(deviceEvent);
			await auditLogClient.logOrgEvent(applicationEvent);
			await auditLogClient.logOrgEvent(anotherDeviceEvent);

			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Query for specific device resource
			const deviceResults = await auditLogClient.query({
				orgId,
				resource: 'device/123',
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(deviceResults).to.have.lengthOf.at.least(1);
			expect(deviceResults.every(r => {
				const orgEvent = expectOrgEvent(r);
				return orgEvent.resource === 'device/123';
			})).to.be.true;

			// Query for specific application resource
			const applicationResults = await auditLogClient.query({
				orgId,
				resource: 'application/456',
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(applicationResults).to.have.lengthOf.at.least(1);
			expect(applicationResults.every(r => {
				const orgEvent = expectOrgEvent(r);
				return orgEvent.resource === 'application/456';
			})).to.be.true;
		});

		it('should handle orgEvents with multiple resources', async () => {
			const orgId = 11001;

			// Create an org event that affects multiple resources
			const multiResourceEvent: BalenaOrgEvent = {
				action: 'release_created',
				actorId: 2222,
				actorDisplayName: 'Bulk Admin',
				organizationId: orgId,
				resource: [
					'device/1001',
					'device/1002',
					'device/1003',
					'device/1004',
					'device/1005',
					'device/1006',
				],
				metadata: {
					operation: 'bulk_restart',
					reason: 'maintenance'
				},
			};

			await auditLogClient.logOrgEvent(multiResourceEvent);

			await new Promise((resolve) => setTimeout(resolve, 1500));

			// Query for the org to get all the individual resource entries
			const allResults = await auditLogClient.query({
				orgId,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			// Should have created 6 separate log entries
			const bulkOperationEntries = allResults.filter(r => {
				try {
					const orgEvent = expectOrgEvent(r);
					return orgEvent.action === 'release_created';
				} catch {
					return false;
				}
			});

			expect(bulkOperationEntries).to.have.lengthOf(6);

			// Verify each resource was logged separately
			const resources = bulkOperationEntries.map(r => {
				const orgEvent = expectOrgEvent(r);
				return orgEvent.resource;
			});

			expect(resources).to.include('device/1001');
			expect(resources).to.include('device/1002');
			expect(resources).to.include('device/1003');
			expect(resources).to.include('device/1004');
			expect(resources).to.include('device/1005');
			expect(resources).to.include('device/1006');

			// All should have the same metadata
			bulkOperationEntries.forEach(entry => {
				expect(entry.metadata).to.deep.equal({
					operation: 'bulk_restart',
					reason: 'maintenance'
				});
			});

			// Query for a specific resource from the bulk operation
			const specificResourceResult = await auditLogClient.query({
				orgId,
				resource: 'device/1003',
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(specificResourceResult).to.have.lengthOf.at.least(1);
			const filteredBulkOp = specificResourceResult.find(r => {
				const orgEvent = expectOrgEvent(r);
				return orgEvent.action === 'release_created';
			});
			expect(filteredBulkOp).to.exist;
			const orgEvent = expectOrgEvent(filteredBulkOp!);
			expect(orgEvent.resource).to.equal('device/1003');
		});

		it('should combine limit and direction parameters correctly', async () => {
			const userId = 12001;
			const events: BalenaUserEvent[] = [];

			// Create 8 events with identifiable order
			for (let i = 1; i <= 8; i++) {
				events.push({
					action: 'user_login',
					actorId: 3333,
					actorDisplayName: `Combined Test User`,
					userId,
					metadata: {
						sequence: i,
						test: 'combined_params'
					},
				});
			}

			// Log events with delays to ensure ordering
			for (const event of events) {
				await auditLogClient.logUserEvent(event);
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			await new Promise((resolve) => setTimeout(resolve, 1000));

			// Get the newest 3 events (backward direction with limit)
			const newestThree = await auditLogClient.query({
				userId,
				direction: 'backward',
				limit: 3,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(newestThree).to.have.lengthOf(3);
			// Should get sequences 8, 7, 6 (newest first)
			expect(newestThree[0].metadata?.sequence).to.equal(8);
			expect(newestThree[1].metadata?.sequence).to.equal(7);
			expect(newestThree[2].metadata?.sequence).to.equal(6);

			// Get the oldest 3 events (forward direction with limit)
			const oldestThree = await auditLogClient.query({
				userId,
				direction: 'forward',
				limit: 3,
				start: new Date(Date.now() - 3600000).toISOString(),
				end: new Date(Date.now() + 3600000).toISOString(),
			});

			expect(oldestThree).to.have.lengthOf(3);
			// Should get sequences 1, 2, 3 (oldest first)
			expect(oldestThree[0].metadata?.sequence).to.equal(1);
			expect(oldestThree[1].metadata?.sequence).to.equal(2);
			expect(oldestThree[2].metadata?.sequence).to.equal(3);
		});

		describe('Multi-tenant queries', () => {
			it('should query both user and organization events simultaneously', async () => {
				const userId = 5001;
				const orgId = 4001;

				const userEvent: BalenaUserEvent = {
					action: 'user_login',
					actorId: userId,
					actorDisplayName: 'Multi-tenant User',
					userId,
					metadata: { ip: '10.0.0.1' },
				};

				const orgEvent: BalenaOrgEvent = {
					action: 'org_member_added',
					actorId: userId,
					actorDisplayName: 'Multi-tenant User',
					organizationId: orgId,
					resource: 'organization',
					metadata: { newMemberEmail: 'test@example.com' },
				};

				await auditLogClient.logUserEvent(userEvent);
				await auditLogClient.logOrgEvent(orgEvent);

				await new Promise((resolve) => setTimeout(resolve, 1000));

				const queryResult = await auditLogClient.query({
					userId,
					orgId,
					start: new Date(Date.now() - 3600000).toISOString(),
					end: new Date(Date.now() + 3600000).toISOString(),
				});

				expect(queryResult).to.have.lengthOf.at.least(2);

				const userEvents = queryResult.filter(r => {
					try {
						expectUserEvent(r);
						return true;
					} catch {
						return false;
					}
				});

				const orgEvents = queryResult.filter(r => {
					try {
						expectOrgEvent(r);
						return true;
					} catch {
						return false;
					}
				});

				expect(userEvents).to.have.lengthOf.at.least(1);
				expect(orgEvents).to.have.lengthOf.at.least(1);

				const userEventResult = expectUserEvent(userEvents[0]);
				expect(userEventResult.userId).to.equal(userId);
				expect(userEventResult.action).to.equal('user_login');

				const orgEventResult = expectOrgEvent(orgEvents[0]);
				expect(orgEventResult.organizationId).to.equal(orgId);
				expect(orgEventResult.action).to.equal('org_member_added');
			});

			it('should filter multi-tenant queries by actor ID', async () => {
				const userId = 6001;
				const orgId = 5001;
				const actorId = 9999;
				const otherActorId = 8888;

				const userEventByActor: BalenaUserEvent = {
					action: 'user_logout',
					actorId,
					actorDisplayName: 'Specific Actor',
					userId,
					metadata: { reason: 'manual' },
				};

				const orgEventByActor: BalenaOrgEvent = {
					action: 'org_settings_updated',
					actorId,
					actorDisplayName: 'Specific Actor',
					organizationId: orgId,
					resource: 'organization',
					metadata: { setting: 'privacy' },
				};

				const userEventByOtherActor: BalenaUserEvent = {
					action: 'user_login',
					actorId: otherActorId,
					actorDisplayName: 'Other Actor',
					userId,
					metadata: { ip: '192.168.1.100' },
				};

				await auditLogClient.logUserEvent(userEventByActor);
				await auditLogClient.logOrgEvent(orgEventByActor);
				await auditLogClient.logUserEvent(userEventByOtherActor);

				await new Promise((resolve) => setTimeout(resolve, 1000));

				const queryResult = await auditLogClient.query({
					userId,
					orgId,
					actorId,
					start: new Date(Date.now() - 3600000).toISOString(),
					end: new Date(Date.now() + 3600000).toISOString(),
				});

				expect(queryResult).to.have.lengthOf.at.least(2);
				expect(queryResult.every(r => r.actorId === actorId)).to.be.true;

				const hasUserEvent = queryResult.some(r => {
					try {
						const userEvent = expectUserEvent(r);
						return userEvent.action === 'user_logout';
					} catch {
						return false;
					}
				});

				const hasOrgEvent = queryResult.some(r => {
					try {
						const orgEvent = expectOrgEvent(r);
						return orgEvent.action === 'org_settings_updated';
					} catch {
						return false;
					}
				});

				expect(hasUserEvent).to.be.true;
				expect(hasOrgEvent).to.be.true;
			});

			it('should handle multi-tenant queries with multiple organization IDs', async () => {
				const userId = 7001;
				const org1Id = 6001;
				const org2Id = 6002;

				const userEvent: BalenaUserEvent = {
					action: 'user_profile_updated',
					actorId: userId,
					actorDisplayName: 'Profile User',
					userId,
					metadata: { field: 'email' },
				};

				const org1Event: BalenaOrgEvent = {
					action: 'org_application_created',
					actorId: userId,
					actorDisplayName: 'Profile User',
					organizationId: org1Id,
					resource: 'application',
					metadata: { appName: 'test-app-1' },
				};

				const org2Event: BalenaOrgEvent = {
					action: 'org_application_created',
					actorId: userId,
					actorDisplayName: 'Profile User',
					organizationId: org2Id,
					resource: 'application',
					metadata: { appName: 'test-app-2' },
				};

				await auditLogClient.logUserEvent(userEvent);
				await auditLogClient.logOrgEvent(org1Event);
				await auditLogClient.logOrgEvent(org2Event);

				await new Promise((resolve) => setTimeout(resolve, 1000));

				const queryResult = await auditLogClient.query({
					userId,
					orgId: [org1Id, org2Id],
					start: new Date(Date.now() - 3600000).toISOString(),
					end: new Date(Date.now() + 3600000).toISOString(),
				});

				expect(queryResult).to.have.lengthOf.at.least(3);

				const userEvents = queryResult.filter(r => {
					try {
						expectUserEvent(r);
						return true;
					} catch {
						return false;
					}
				});

				const orgEvents = queryResult.filter(r => {
					try {
						expectOrgEvent(r);
						return true;
					} catch {
						return false;
					}
				});

				expect(userEvents).to.have.lengthOf.at.least(1);
				expect(orgEvents).to.have.lengthOf.at.least(2);

				const orgIds = orgEvents.map(r => {
					const orgEvent = expectOrgEvent(r);
					return orgEvent.organizationId;
				});

				expect(orgIds).to.include(org1Id);
				expect(orgIds).to.include(org2Id);
			});
		});
	});
};

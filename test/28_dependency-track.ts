import { expect } from 'chai';
import { setTimeout } from 'timers/promises';
import * as fixtures from './test-lib/fixtures.js';
import { supertest } from './test-lib/supertest.js';
import {
	analyzeProject,
	createApiWebhookNotificationRule,
	createVulnPolicy,
	dependencyTrackFetch,
	dependencyTrackUrl,
	getDependencyTrackApiKey,
	getComponents,
	getFindings,
	getNotificationRules,
	getVulnerability,
	seedVulnerability,
	waitForDependencyTrack,
	waitForTokenProcessed,
} from './test-lib/dependency-track.js';
import {
	clearReceivedNotifications,
	DEPENDENCY_TRACK_NOTIFICATION_ROUTE,
	getReceivedNotifications,
} from '../src/features/sbom-management/index.js';
import bom from './fixtures/28-dependency-track/bom.json' with { type: 'json' };
import vex from './fixtures/28-dependency-track/vex.json' with { type: 'json' };
import vulnerabilities from './fixtures/28-dependency-track/vulnerabilities.json' with { type: 'json' };
import vulnPolicy from './fixtures/28-dependency-track/vuln-policy.json' with { type: 'json' };

interface DependencyTrackProject {
	uuid: string;
	name: string;
	version: string;
}

const lookupProject = async (
	name: string,
	version: string,
): Promise<DependencyTrackProject | undefined> => {
	const res = await dependencyTrackFetch(
		`/api/v1/project/lookup?name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`,
	);
	if (res.status === 404) {
		return undefined;
	}
	if (!res.ok) {
		throw new Error(`Project lookup failed: ${res.status} ${await res.text()}`);
	}
	return (await res.json()) as DependencyTrackProject;
};

/**
 * Dependency-Track queues uploaded boms and processes them asynchronously, so the
 * project an upload creates only becomes visible some time after the upload call
 * has already returned.
 */
const waitForProject = async (
	name: string,
	version: string,
	timeoutMs = 60_000,
): Promise<DependencyTrackProject> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const project = await lookupProject(name, version);
		if (project != null) {
			return project;
		}
		await setTimeout(1000);
	}
	throw new Error(
		`Dependency-Track did not create a project for ${name}@${version} within ${timeoutMs}ms`,
	);
};

/**
 * Dependency-Track publishes once the work behind an event has finished, so
 * deliveries trail the call that triggered them.
 */
const waitForNotification = async (group: string, timeoutMs = 90_000) => {
	const deadline = Date.now() + timeoutMs;
	let seen: string[] = [];
	while (Date.now() < deadline) {
		seen = getReceivedNotifications().map(
			({ notification }) => notification.group,
		);
		if (seen.includes(group)) {
			return;
		}
		await setTimeout(1000);
	}
	throw new Error(
		`No ${group} notification reached ${DEPENDENCY_TRACK_NOTIFICATION_ROUTE} within ${timeoutMs}ms (received: ${seen.join(', ') || 'none'})`,
	);
};

export default () => {
	describe('dependency track', function () {
		before(async function () {
			// The apiserver boots a JVM and runs its schema migration on first start,
			// which takes far longer than the suite's default timeout.
			this.timeout(300_000);
			await waitForDependencyTrack();
			this.apiKey = await getDependencyTrackApiKey();

			const fx = await fixtures.load('28-dependency-track');
			this.loadedFixtures = fx;
			this.application = fx.applications.app1;
			this.release = fx.releases.release1;

			// Seeded before the sbom is uploaded, so that the analysis which runs as
			// part of processing it already has something to match against.
			for (const vulnerability of Object.values(vulnerabilities)) {
				await seedVulnerability(vulnerability);
			}

			// Registered before anything is uploaded, since Dependency-Track only
			// publishes to rules that already existed when the event fired.
			clearReceivedNotifications();
			this.notificationRuleUuid = await createApiWebhookNotificationRule({
				name: 'open-balena-api test receiver',
				route: DEPENDENCY_TRACK_NOTIFICATION_ROUTE,
				notifyOn: ['BOM_PROCESSED', 'VEX_PROCESSED'],
			});
			// A separate rule, so that a policy changing a finding's analysis is
			// observed on its own rather than folded in with the upload events.
			this.auditNotificationRuleUuid = await createApiWebhookNotificationRule({
				name: 'open-balena-api test audit receiver',
				route: DEPENDENCY_TRACK_NOTIFICATION_ROUTE,
				notifyOn: ['PROJECT_AUDIT_CHANGE'],
			});
		});

		after(async function () {
			// `before` can fail ahead of the fixtures loading, and cleaning nothing
			// throws an error of its own that buries whatever actually went wrong.
			if (this.loadedFixtures != null) {
				await fixtures.clean(this.loadedFixtures);
			}
		});

		it('should provision an api key for the Administrators team', function () {
			expect(this.apiKey).to.be.a('string').that.is.not.empty;
		});

		it('should authenticate an api request using the provisioned key', async function () {
			const res = await dependencyTrackFetch('/api/v1/team?pageSize=1');
			expect(res.status).to.equal(200);
		});

		it('should reject an api request carrying an unknown key', async function () {
			const res = await fetch(`${dependencyTrackUrl}/api/v1/team`, {
				headers: { 'X-Api-Key': 'not-a-valid-api-key' },
			});
			expect(res.status).to.be.oneOf([401, 403]);
		});

		it('should memoise the api key across calls', async function () {
			expect(await getDependencyTrackApiKey()).to.equal(this.apiKey);
		});

		it('should expose the api key to the app via the environment', function () {
			expect(process.env.DEPENDENCY_TRACK_API_KEY).to.equal(this.apiKey);
		});

		it('should record a notification posted straight to the api route', async function () {
			// Exercises the receiver without involving Dependency-Track, so a broken
			// route can be told apart from a delivery that was never made.
			const before = getReceivedNotifications().length;
			await supertest()
				.post(DEPENDENCY_TRACK_NOTIFICATION_ROUTE)
				.send({
					notification: {
						group: 'BOM_PROCESSED',
						level: 'INFORMATIONAL',
						scope: 'PORTFOLIO',
						title: 'posted directly by the test suite',
					},
				})
				.expect(204);

			const recorded = getReceivedNotifications();
			expect(recorded).to.have.lengthOf(before + 1);
			expect(recorded.at(-1)?.notification.title).to.equal(
				'posted directly by the test suite',
			);
		});

		it('should have stored the webhook rule with our destination and events', async function () {
			// Confirms Dependency-Track kept what we sent it. A rule that is disabled,
			// or that lost its notifyOn set, silently never publishes.
			const rules = await getNotificationRules();
			const rule = rules.find(({ uuid }) => uuid === this.notificationRuleUuid);

			expect(rule, 'the rule created in before() is missing').to.not.be
				.undefined;
			expect(rule).to.have.property('enabled', true);
			expect(rule?.notifyOn ?? []).to.include('BOM_PROCESSED');
			expect(rule?.publisherConfig ?? '').to.contain(
				DEPENDENCY_TRACK_NOTIFICATION_ROUTE,
			);
		});

		it('should accept a CycloneDX sbom and auto create the project', async function () {
			// Mirrors how the api submits release assets: the fleet slug becomes the
			// project name and the release commit its version.
			this.timeout(120_000);
			const projectName = this.application.slug;
			const projectVersion = this.release.commit;

			expect(projectName).to.be.a('string').that.is.not.empty;
			expect(projectVersion).to.be.a('string').that.is.not.empty;

			const form = new FormData();
			form.append('projectName', projectName);
			form.append('projectVersion', projectVersion);
			form.append('autoCreate', 'true');
			form.append(
				'bom',
				new Blob([JSON.stringify(bom)], { type: 'application/json' }),
				'bom.json',
			);

			const uploadRes = await dependencyTrackFetch('/api/v1/bom', {
				method: 'POST',
				body: form,
			});
			expect(uploadRes.status).to.equal(200);

			// The project appears as soon as processing starts, well before the
			// components and their analysis are in place, so drain the upload's own
			// token rather than letting later assertions race it.
			const { token } = (await uploadRes.json()) as { token: string };
			await waitForTokenProcessed(token);

			const project = await waitForProject(projectName, projectVersion);
			expect(project).to.have.property('name', projectName);
			expect(project).to.have.property('version', projectVersion);
		});

		it('should cover both a triaged and an untriaged vulnerability', function () {
			// Guards the fixture itself: the upload below is only meaningful while it
			// carries a vulnerability that has been analysed and one that is merely
			// known, so losing either shape should fail loudly rather than silently
			// narrow what the vex test exercises.
			const triaged = vex.vulnerabilities.filter(
				(vulnerability) => 'analysis' in vulnerability,
			);
			expect(vex.vulnerabilities).to.have.lengthOf(2);
			expect(triaged).to.have.lengthOf(1);
		});

		it('should accept a CycloneDX vex document for the project', async function () {
			this.timeout(120_000);
			const projectName = this.application.slug;
			const projectVersion = this.release.commit;

			// The api only submits vex once the sbom has created the project, so
			// resolve the project first, the same way the release asset task does.
			const project = await waitForProject(projectName, projectVersion);

			const res = await dependencyTrackFetch('/api/v1/vex', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					project: project.uuid,
					projectName,
					projectVersion,
					vex: Buffer.from(JSON.stringify(vex)).toString('base64'),
				}),
			});
			expect(res.status).to.equal(200);
		});

		it('should deliver a notification to the api webhook route', async function () {
			this.timeout(120_000);
			await waitForNotification('BOM_PROCESSED');
		});

		it('should have stored the seeded vulnerabilities', async function () {
			// If seeding silently dropped the affected components there is nothing for
			// the internal analyzer to match, and every later step fails downstream of
			// that rather than at the cause.
			for (const { vulnId } of Object.values(vulnerabilities)) {
				const stored = await getVulnerability('INTERNAL', vulnId);
				expect(stored, `${vulnId} was not stored`).to.not.be.undefined;
				expect(
					stored?.affectedComponents ?? [],
					`${vulnId} has no affected components`,
				).to.not.be.empty;
			}
		});

		it('should produce findings for the seeded vulnerabilities', async function () {
			// The policy can only triage a finding that exists. Running the analysis
			// explicitly — and waiting for its token — means an empty result here is a
			// matching failure rather than a race, which is the difference between
			// "the seeded purl is wrong" and "we looked too early".
			this.timeout(180_000);
			const project = await waitForProject(
				this.application.slug,
				this.release.commit,
			);
			await analyzeProject(project.uuid);

			const findings = await getFindings(project.uuid);
			const vulnIds = findings.map(({ vulnerability }) => vulnerability.vulnId);
			const components = await getComponents(project.uuid);

			// Reported together, because no finding with no components is a broken bom
			// import, whereas no finding against components that are present points at
			// the seeded affected-component identity.
			expect(
				vulnIds,
				`no finding for the untriaged vulnerability (findings: ${
					vulnIds.join(', ') || 'none'
				}; components: ${
					components.map(({ purl, name }) => purl ?? name).join(', ') || 'none'
				})`,
			).to.include('CVE-2020-8203');
		});

		it('should triage the untriaged finding through a vulnerability policy', async function () {
			// The vex fixture leaves CVE-2020-8203 declared but unanalysed. A policy
			// matching it in APPLY mode is what settles its analysis, and changing an
			// analysis is what Dependency-Track reports as PROJECT_AUDIT_CHANGE.
			this.timeout(180_000);
			const project = await waitForProject(
				this.application.slug,
				this.release.commit,
			);

			this.vulnPolicyUuid = await createVulnPolicy(vulnPolicy);

			// Policies are only evaluated while analysing a project, so one created
			// after the upload takes effect on the next run rather than immediately.
			await analyzeProject(project.uuid);

			await waitForNotification('PROJECT_AUDIT_CHANGE');
		});

		it('should return 404 when looking up a project that was never uploaded', async function () {
			expect(await lookupProject('no-such-fleet', 'no-such-commit')).to.be
				.undefined;
		});
	});
};

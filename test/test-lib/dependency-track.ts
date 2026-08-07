import { setTimeout } from 'timers/promises';
import { PORT } from '../../src/lib/config.js';

// `DEPENDENCY_TRACK_URL` is a host:port pair rather than a full URL, matching how
// the API itself consumes it. Normalise it so this helper can build request URLs
// without caring which form it was given.
const configuredUrl = process.env.DEPENDENCY_TRACK_URL ?? 'dtrack:8080';
export const dependencyTrackUrl = /^https?:\/\//.test(configuredUrl)
	? configuredUrl
	: `http://${configuredUrl}`;

const ADMIN_USERNAME = 'admin';
const DEFAULT_ADMIN_PASSWORD = 'admin';
// Dependency-Track forces a password change on first login and there is no way to
// preseed credentials (v5 seeding creates structural defaults only), so the suite
// picks the replacement password itself.
const TEST_ADMIN_PASSWORD = 'DependencyTrackTest1!';

interface DependencyTrackTeam {
	uuid: string;
	name: string;
}

const formPost = async (path: string, data: Record<string, string>) =>
	await fetch(`${dependencyTrackUrl}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(data).toString(),
	});

/**
 * Dependency-Track boots a JVM and runs its schema migration on first start, which
 * takes far longer than the default mocha timeout. Only tests that actually need
 * DT should pay for this, so nothing waits on it during suite startup.
 */
export const waitForDependencyTrack = async (timeoutMs = 300_000) => {
	const deadline = Date.now() + timeoutMs;
	let lastError = 'no attempt was made';
	// `/health/ready` is the MicroProfile readiness probe and `/api/version` is the
	// unauthenticated version endpoint; either answering means DT is serving.
	const readinessPaths = ['/health/ready', '/api/version'];

	while (Date.now() < deadline) {
		for (const path of readinessPaths) {
			try {
				const res = await fetch(`${dependencyTrackUrl}${path}`);
				if (res.ok) {
					return;
				}
				lastError = `${path} returned ${res.status}`;
			} catch (err) {
				lastError = `${path}: ${err}`;
			}
		}
		await setTimeout(2000);
	}

	throw new Error(
		`Dependency-Track at ${dependencyTrackUrl} was not ready within ${timeoutMs}ms (last error: ${lastError})`,
	);
};

const login = async (password: string): Promise<string | undefined> => {
	const res = await formPost('/api/v1/user/login', {
		username: ADMIN_USERNAME,
		password,
	});
	if (!res.ok) {
		return undefined;
	}
	// The JWT is returned as a plain-text body rather than JSON.
	return (await res.text()).trim();
};

const getAdminJwt = async (): Promise<string> => {
	// A DT instance carried over from a previous run (`--preserve-volumes`) already
	// has the suite password set, so try that before touching the default.
	const existing = await login(TEST_ADMIN_PASSWORD);
	if (existing != null) {
		return existing;
	}

	// On a fresh instance DT refuses to issue a token until the forced password
	// change has happened, so drive that and log in again.
	const changeRes = await formPost('/api/v1/user/forceChangePassword', {
		username: ADMIN_USERNAME,
		password: DEFAULT_ADMIN_PASSWORD,
		newPassword: TEST_ADMIN_PASSWORD,
		confirmPassword: TEST_ADMIN_PASSWORD,
	});

	const jwt = await login(TEST_ADMIN_PASSWORD);
	if (jwt != null) {
		return jwt;
	}

	// Some versions do not force the change; fall back to the untouched default.
	const withDefault = await login(DEFAULT_ADMIN_PASSWORD);
	if (withDefault != null) {
		return withDefault;
	}

	throw new Error(
		`Could not obtain a Dependency-Track admin token for '${ADMIN_USERNAME}' ` +
			`(forceChangePassword returned ${changeRes.status})`,
	);
};

const getAdministratorsTeam = async (
	jwt: string,
): Promise<DependencyTrackTeam> => {
	const res = await fetch(`${dependencyTrackUrl}/api/v1/team?pageSize=100`, {
		headers: { Authorization: `Bearer ${jwt}` },
	});
	if (!res.ok) {
		throw new Error(
			`Listing Dependency-Track teams failed: ${res.status} ${await res.text()}`,
		);
	}

	// Team listings are paginated through query params and an X-Total-Count header,
	// but the body itself stays a bare array. `pageSize` defaults to 100 anyway;
	// it is passed explicitly so a future default change cannot truncate the list.
	const teams = (await res.json()) as DependencyTrackTeam[];

	// The built-in Administrators team already holds every permission, which saves
	// the suite from assembling a permission set of its own.
	const team = teams.find(({ name }) => name === 'Administrators');
	if (team == null) {
		throw new Error(
			`No 'Administrators' team in Dependency-Track (found: ${
				teams.map(({ name }) => name).join(', ') || 'none'
			})`,
		);
	}
	return team;
};

const createApiKey = async (jwt: string, teamUuid: string): Promise<string> => {
	const res = await fetch(`${dependencyTrackUrl}/api/v1/team/${teamUuid}/key`, {
		method: 'PUT',
		headers: { Authorization: `Bearer ${jwt}` },
	});
	if (!res.ok) {
		throw new Error(
			`Creating a Dependency-Track api key failed: ${res.status} ${await res.text()}`,
		);
	}

	// Keys are stored hashed, so `key` holds the plaintext only in the response to
	// the call that created it — every later read returns `maskedKey` instead.
	const { key } = (await res.json()) as { key?: string };
	if (typeof key !== 'string' || key === '') {
		throw new Error(
			'Dependency-Track returned an api key without a plaintext value',
		);
	}
	return key;
};

let apiKeyPromise: Promise<string> | undefined;

/**
 * Lazily provisions an api key and memoises it for the rest of the process.
 *
 * Dependency-Track generates keys server side, so there is nothing to preseed via
 * the environment. Rather than bootstrapping during suite startup — which would
 * make every non-DT run wait on the JVM — the REST dance runs the first time a
 * test asks for a key.
 */
export const getDependencyTrackApiKey = async (): Promise<string> => {
	apiKeyPromise ??= (async () => {
		const jwt = await getAdminJwt();
		const team = await getAdministratorsTeam(jwt);
		const apiKey = await createApiKey(jwt, team.uuid);
		// Publish it the same way a deployment would, so code under test reads it
		// from the environment and stays unaware of how it was obtained.
		process.env.DEPENDENCY_TRACK_API_KEY = apiKey;
		return apiKey;
	})().catch((err) => {
		// Don't cache a failed bootstrap, so a later test can retry it.
		apiKeyPromise = undefined;
		throw err;
	});

	return await apiKeyPromise;
};

/** Issues an api-key-authenticated request against Dependency-Track. */
export const dependencyTrackFetch = async (
	path: string,
	init: RequestInit = {},
): Promise<Response> => {
	const apiKey = await getDependencyTrackApiKey();
	return await fetch(`${dependencyTrackUrl}${path}`, {
		...init,
		headers: { ...init.headers, 'X-Api-Key': apiKey },
	});
};

/**
 * Where Dependency-Track reaches the api to deliver notifications.
 *
 * Nothing needs publishing to the docker host for this: both containers sit on
 * the `local-test` network, so traffic goes straight to the api's own port. The
 * `sut` alias is what makes the suite addressable at all, because
 * `docker compose run` does not name its containers after the service.
 */
export const apiWebhookOrigin = `http://sut:${PORT}`;

interface NotificationPublisher {
	uuid: string;
	name: string;
	extensionName?: string;
}

/**
 * Registers a vulnerability with Dependency-Track's own `INTERNAL` source.
 *
 * The test stack mirrors no vulnerability source — that is what makes it cheap to
 * run — so nothing would otherwise match the components in an uploaded sbom, and
 * a vex document or a policy would have no findings to act on.
 */
export const seedVulnerability = async (
	vulnerability: unknown,
): Promise<void> => {
	const res = await dependencyTrackFetch('/api/v1/vulnerability', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(vulnerability),
	});
	// A run against a preserved database has seeded it already.
	if (res.status === 409) {
		return;
	}
	if (!res.ok) {
		throw new Error(
			`Seeding a Dependency-Track vulnerability failed: ${res.status} ${await res.text()}`,
		);
	}
};

/**
 * Creates a vulnerability policy through the v2 api, which is where policy
 * management lives — v1 has no equivalent. Conditions are CEL, compiled server
 * side, so a malformed one comes back as a 400 naming the line and column.
 */
export const createVulnPolicy = async (policy: unknown): Promise<string> => {
	const res = await dependencyTrackFetch('/api/v2/vuln-policies', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(policy),
	});
	if (!res.ok) {
		throw new Error(
			`Creating a Dependency-Track vulnerability policy failed: ${res.status} ${await res.text()}`,
		);
	}
	const { uuid } = (await res.json()) as { uuid: string };
	return uuid;
};

/**
 * Waits for a processing token to drain. Bom uploads, vex uploads and analyses
 * all only queue their work and hand one back.
 */
export const waitForTokenProcessed = async (
	token: string,
	timeoutMs = 120_000,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const res = await dependencyTrackFetch(`/api/v1/event/token/${token}`);
		if (res.ok) {
			const { processing } = (await res.json()) as { processing: boolean };
			if (!processing) {
				return;
			}
		}
		await setTimeout(1000);
	}
	throw new Error(
		`Dependency-Track token ${token} was still processing after ${timeoutMs}ms`,
	);
};

/**
 * Re-runs vulnerability analysis for a project and waits for it to finish.
 *
 * Policies are evaluated every time a project's vulnerabilities are analysed, so
 * one created after an upload only takes effect once this has run. Nothing is
 * visible — and nothing is published — until the returned token drains.
 */
export const analyzeProject = async (projectUuid: string): Promise<void> => {
	const res = await dependencyTrackFetch(
		`/api/v1/finding/project/${projectUuid}/analyze`,
		{ method: 'POST' },
	);
	if (!res.ok) {
		throw new Error(
			`Re-analysing Dependency-Track project ${projectUuid} failed: ${res.status} ${await res.text()}`,
		);
	}
	const { token } = (await res.json()) as { token: string };
	await waitForTokenProcessed(token);
};

export interface DependencyTrackFinding {
	vulnerability: { vulnId?: string; source?: string };
	component: { name?: string; version?: string; purl?: string };
	analysis?: { state?: string; isSuppressed?: boolean };
}

/** The findings a project's analysis produced. */
export const getFindings = async (
	projectUuid: string,
): Promise<DependencyTrackFinding[]> => {
	const res = await dependencyTrackFetch(
		`/api/v1/finding/project/${projectUuid}`,
	);
	if (!res.ok) {
		throw new Error(
			`Listing Dependency-Track findings failed: ${res.status} ${await res.text()}`,
		);
	}
	return (await res.json()) as DependencyTrackFinding[];
};

export interface DependencyTrackComponent {
	name?: string;
	version?: string;
	purl?: string;
}

/** The components a bom import created for a project. */
export const getComponents = async (
	projectUuid: string,
): Promise<DependencyTrackComponent[]> => {
	const res = await dependencyTrackFetch(
		`/api/v1/component/project/${projectUuid}?pageSize=100`,
	);
	if (!res.ok) {
		throw new Error(
			`Listing Dependency-Track components failed: ${res.status} ${await res.text()}`,
		);
	}
	return (await res.json()) as DependencyTrackComponent[];
};

/** Reads a vulnerability back, to check what seeding actually stored. */
export const getVulnerability = async (
	source: string,
	vulnId: string,
): Promise<{ vulnId?: string; affectedComponents?: unknown[] } | undefined> => {
	const res = await dependencyTrackFetch(
		`/api/v1/vulnerability/source/${source}/vuln/${vulnId}`,
	);
	if (res.status === 404) {
		return undefined;
	}
	if (!res.ok) {
		throw new Error(
			`Reading Dependency-Track vulnerability ${source}/${vulnId} failed: ${res.status} ${await res.text()}`,
		);
	}
	return (await res.json()) as {
		vulnId?: string;
		affectedComponents?: unknown[];
	};
};

export interface DependencyTrackNotificationRule {
	uuid: string;
	name: string;
	enabled?: boolean;
	notifyOn?: string[];
	/** A JSON-encoded string, not an object. */
	publisherConfig?: string;
}

/** Reads rules back, to check what Dependency-Track actually stored. */
export const getNotificationRules = async (): Promise<
	DependencyTrackNotificationRule[]
> => {
	const res = await dependencyTrackFetch(
		'/api/v1/notification/rule?pageSize=100',
	);
	if (!res.ok) {
		throw new Error(
			`Listing Dependency-Track notification rules failed: ${res.status} ${await res.text()}`,
		);
	}
	return (await res.json()) as DependencyTrackNotificationRule[];
};

const getWebhookPublisher = async (): Promise<NotificationPublisher> => {
	const res = await dependencyTrackFetch('/api/v1/notification/publisher');
	if (!res.ok) {
		throw new Error(
			`Listing Dependency-Track notification publishers failed: ${res.status} ${await res.text()}`,
		);
	}

	const publishers = (await res.json()) as NotificationPublisher[];
	const publisher = publishers.find(({ name, extensionName }) =>
		/webhook/i.test(extensionName ?? name),
	);
	if (publisher == null) {
		throw new Error(
			`No outbound webhook publisher in Dependency-Track (found: ${
				publishers.map(({ name }) => name).join(', ') || 'none'
			})`,
		);
	}
	return publisher;
};

/**
 * Points Dependency-Track at an api route for the given events.
 *
 * Creation and configuration are two calls: the create request only accepts a
 * name, scope, level and publisher, so the destination and the event selection
 * have to follow in an update.
 */
export const createApiWebhookNotificationRule = async ({
	name,
	route,
	notifyOn,
}: {
	name: string;
	route: string;
	notifyOn: string[];
}): Promise<string> => {
	const publisher = await getWebhookPublisher();

	const createRes = await dependencyTrackFetch('/api/v1/notification/rule', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			name,
			scope: 'PORTFOLIO',
			level: 'INFORMATIONAL',
			publisher: { uuid: publisher.uuid },
		}),
	});
	if (!createRes.ok) {
		throw new Error(
			`Creating a Dependency-Track notification rule failed: ${createRes.status} ${await createRes.text()}`,
		);
	}
	const { uuid } = (await createRes.json()) as { uuid: string };

	const updateRes = await dependencyTrackFetch('/api/v1/notification/rule', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			uuid,
			name,
			scope: 'PORTFOLIO',
			level: 'INFORMATIONAL',
			enabled: true,
			notifyOn,
			// publisherConfig is itself a JSON-encoded string rather than an object,
			// and it is validated against the publisher's own runtime config schema
			// — readable at /api/v1/notification/publisher/{uuid}/configSchema if a
			// future version wants different keys than this one.
			publisherConfig: JSON.stringify({
				destinationUrl: `${apiWebhookOrigin}${route}`,
			}),
		}),
	});
	if (!updateRes.ok) {
		throw new Error(
			`Configuring the Dependency-Track notification rule failed: ${updateRes.status} ${await updateRes.text()}`,
		);
	}

	return uuid;
};

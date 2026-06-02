import * as mockttp from 'mockttp';
import { fileURLToPath } from 'node:url';

// A self-signed CA committed under test/fixtures so mockttp can MITM HTTPS hosts.
// The same cert is trusted by Node via NODE_EXTRA_CA_CERTS (set in the test env),
// which is why it must be a stable, committed pair rather than generated per-run.
const caKeyPath = fileURLToPath(
	new URL('../fixtures/mockttp-ca/ca.key', import.meta.url),
);
const caCertPath = fileURLToPath(
	new URL('../fixtures/mockttp-ca/ca.pem', import.meta.url),
);

let mockServer: mockttp.Mockttp | undefined;

export function getMockServer(): mockttp.Mockttp {
	if (mockServer == null) {
		throw new Error('mockttp server has not been started');
	}
	return mockServer;
}

export async function start() {
	mockServer = mockttp.getLocal({
		https: { keyPath: caKeyPath, certPath: caCertPath },
	});
	await mockServer.start();

	// Route the app's outbound HTTP(S) through the mock proxy. Only hosts that are
	// NOT in NO_PROXY reach mockttp; everything still served by nock (or by in-suite
	// infrastructure) is listed here and bypasses the proxy entirely. As each
	// endpoint is migrated to mockttp, drop its host from NO_PROXY so it starts
	// flowing through the proxy — until then nock keeps intercepting it directly.
	const proxyUrl = `http://localhost:${mockServer.port}`;
	process.env.HTTP_PROXY = proxyUrl;
	process.env.HTTPS_PROXY = proxyUrl;
	process.env.NO_PROXY = [
		// in-suite infrastructure (never proxied)
		'localhost',
		'127.0.0.1',
		'db',
		'redis',
		'loki',
		'minio-server',
		// still served by nock — remove each host as it migrates to mockttp
		'.balena',
	].join(',');
}

export async function stop() {
	delete process.env.HTTP_PROXY;
	delete process.env.HTTPS_PROXY;
	delete process.env.NO_PROXY;
	await mockServer?.stop();
	mockServer = undefined;
}

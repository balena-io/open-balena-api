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
}

export async function stop() {
	await mockServer?.stop();
	mockServer = undefined;
}

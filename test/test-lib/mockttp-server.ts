import * as mockttp from 'mockttp';
import { fileURLToPath } from 'node:url';
import { VPN_CONNECT_PROXY_PORT } from '../../src/lib/config.js';

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
	// Listen on the VPN connect-proxy port. The device-proxy reaches devices by
	// tunnelling through an explicit proxy at `<vpnIp>:VPN_CONNECT_PROXY_PORT`
	// (it ignores HTTP_PROXY), so binding here lets the same mock server also
	// intercept those `${uuid}.balena` requests — see connect-device-and-wait.
	await mockServer.start(VPN_CONNECT_PROXY_PORT);

	// Route the app's env-proxy-aware outbound HTTP(S) through the same mock proxy.
	// Only hosts NOT in NO_PROXY reach mockttp; in-suite infrastructure is listed
	// here and bypasses it.
	const proxyUrl = `http://localhost:${VPN_CONNECT_PROXY_PORT}`;
	process.env.HTTP_PROXY = proxyUrl;
	process.env.HTTPS_PROXY = proxyUrl;
	process.env.NO_PROXY = [
		'localhost',
		'127.0.0.1',
		'db',
		'redis',
		'loki',
		'minio-server',
	].join(',');
}

export async function stop() {
	delete process.env.HTTP_PROXY;
	delete process.env.HTTPS_PROXY;
	delete process.env.NO_PROXY;
	await mockServer?.stop();
	mockServer = undefined;
}

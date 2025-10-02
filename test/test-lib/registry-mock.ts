import { REGISTRY2_HOST } from '../../src/lib/config.js';
import nock from 'nock';

const REGISTRY_ENDPOINT = `https://${REGISTRY2_HOST}`;

function nockDeleteManifest(): nock.Scope {
	const pathRegex = /\/v2\/([a-zA-Z0-9-_]+)\/manifests\/(sha256:[a-zA-Z0-9]+)/;
	return nock(REGISTRY_ENDPOINT).delete(pathRegex).reply(202).persist();
}

export function start() {
	nockDeleteManifest();
}

export function stop() {
	nock.cleanAll();
}

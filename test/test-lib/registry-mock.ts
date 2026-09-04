import {
	REGISTRY2_HOST,
	REGISTRY_STORAGE_ROOT_PATH,
} from '../../src/lib/config.js';
import { randomUUID } from 'node:crypto';
import {
	addDeleteObjectsResolver,
	addListObjectsV2Resolver,
} from './aws-mock.js';
import { getMockServer } from './mockttp-server.js';

interface RegistryImage {
	repository: string;
	digest: string;
	isDeleted: boolean;
	tags?: string[];
	// Digest of the legacy schema1 signature link stored alongside the manifest
	// revision. The registry's delete API can't remove it, so it's exactly the
	// kind of object that deleting the whole `_manifests` directory must clear.
	signatureDigest: string;
}

const reposPath = `${REGISTRY_STORAGE_ROOT_PATH}/repositories/`;

const store: {
	images: RegistryImage[];
	// Full S3 object keys that currently exist under repositories/.
	objects: Set<string>;
} = {
	images: [],
	objects: new Set(),
};

function revisionLinkKey(image: RegistryImage) {
	const hash = image.digest.replace(/^sha256:/, '');
	return `${reposPath}${image.repository}/_manifests/revisions/sha256/${hash}/link`;
}

// All manifest object keys that back a given image.
function manifestKeysFor(image: RegistryImage) {
	const base = `${reposPath}${image.repository}/_manifests`;
	const hash = image.digest.replace(/^sha256:/, '');
	const signatureHash = image.signatureDigest.replace(/^sha256:/, '');
	const keys = [
		revisionLinkKey(image),
		`${base}/revisions/sha256/${hash}/signatures/sha256/${signatureHash}/link`,
	];
	for (const tag of image.tags ?? []) {
		keys.push(`${base}/tags/${tag}/current/link`);
		keys.push(`${base}/tags/${tag}/index/sha256/${hash}/link`);
	}
	return keys;
}

export function reset() {
	store.images = [];
	store.objects = new Set();
}

export function genDigest() {
	return `sha256:${randomUUID().replace(/-/g, '').toLowerCase()}`;
}

export function addImage(repository: string, digest: string, tags?: string[]) {
	const registryImage: RegistryImage = {
		repository,
		digest,
		isDeleted: false,
		signatureDigest: genDigest(),
		...(tags != null && { tags }),
	};
	store.images.push(registryImage);
	for (const key of manifestKeysFor(registryImage)) {
		store.objects.add(key);
	}
	return registryImage;
}

export function deleteImage(image: RegistryImage) {
	store.images = store.images.filter(
		(i) => i.repository !== image.repository || i.digest !== image.digest,
	);
	for (const key of manifestKeysFor(image)) {
		store.objects.delete(key);
	}
}

// The manifest object keys that currently exist for a given repository.
// Used by tests to assert that the `_manifests` directory has been cleaned up.
export function getManifestObjectKeys(repository: string) {
	const prefix = `${reposPath}${repository}/_manifests/`;
	return [...store.objects].filter((key) => key.startsWith(prefix));
}

export function addCacheImages(
	repository: string,
	stages: number,
	tags?: string[],
) {
	const cacheImages: RegistryImage[] = [];
	for (let i = 0; i < stages; i++) {
		cacheImages.push(addImage(`${repository}-${i}`, genDigest(), tags));
	}
	return cacheImages;
}

let nextDeleteObjectsError: string | null = null;
// Make the next deleteObjects call report a storage error, to exercise the
// task's retry behaviour. Reset after a single call.
export function setNextDeleteObjectsError(message: string | null) {
	nextDeleteObjectsError = message;
}

function registerS3Resolver() {
	const tagDigestsPrefixRegex = new RegExp(
		`^${reposPath}(.+?)/_manifests/tags/(.+?)/index/sha256/$`,
	);
	const manifestsPrefixRegex = new RegExp(`^${reposPath}(.+?)/_manifests/$`);
	return addListObjectsV2Resolver((params) => {
		const prefix = params.Prefix ?? '';
		const tagDigestsMatch = prefix.match(tagDigestsPrefixRegex);
		if (tagDigestsMatch) {
			const repo = tagDigestsMatch[1];
			const tag = tagDigestsMatch[2];
			const commonPrefixes = store.images
				.filter(
					(i) => i.repository === repo && !i.isDeleted && i.tags?.includes(tag),
				)
				.map((i) => ({
					Prefix: `${prefix}${i.digest.replace(/^sha256:/, '')}/`,
				}));
			return { IsTruncated: false, CommonPrefixes: commonPrefixes };
		}
		// Non-delimited listing of a repo's `_manifests` directory, used when
		// deleting the directory. Returns every object key under the prefix.
		if (params.Delimiter == null && manifestsPrefixRegex.test(prefix)) {
			const contents = [...store.objects]
				.filter((key) => key.startsWith(prefix))
				.sort()
				.map((Key) => ({ Key }));
			return { IsTruncated: false, Contents: contents };
		}
		if (prefix.startsWith(reposPath) && prefix !== reposPath) {
			const repoPrefix = prefix.replace(reposPath, '');
			const commonPrefixes = store.images
				.filter((i) => i.repository.startsWith(repoPrefix) && !i.isDeleted)
				.map((i) => ({
					Prefix: `${reposPath}${i.repository}/`,
				}));
			return {
				IsTruncated: false,
				CommonPrefixes: commonPrefixes,
			};
		}
		return undefined;
	});
}

function registerDeleteObjectsResolver() {
	return addDeleteObjectsResolver((params) => {
		const objects = params.Delete.Objects;
		if (nextDeleteObjectsError != null) {
			const message = nextDeleteObjectsError;
			nextDeleteObjectsError = null;
			return {
				Errors: objects.map(({ Key }) => ({
					Key,
					Code: 'InternalError',
					Message: message,
				})),
			};
		}
		for (const { Key } of objects) {
			if (Key != null) {
				store.objects.delete(Key);
			}
		}
		// Reflect the removed objects onto image deletion state: an image is
		// considered deleted once its manifest revision link is gone.
		for (const image of store.images) {
			if (!store.objects.has(revisionLinkKey(image))) {
				image.isDeleted = true;
			}
		}
		return { Deleted: objects.map(({ Key }) => ({ Key })) };
	});
}

// Docker Distribution HTTP API mocks for when the registry s3Client
// isn't available and falls back to making registry API calls.

function getNonDeletedImages(repository: string) {
	return store.images.filter(
		(i) => i.repository === repository && !i.isDeleted,
	);
}

function parseManifestPath(url: string) {
	const { pathname } = new URL(url);
	const [, repo, reference] = /^\/v2\/(.+)\/manifests\/(.+)$/.exec(pathname)!;
	return { repo, reference };
}

async function startRegistryApi() {
	const server = getMockServer();

	await server
		.forGet(/\/v2\/.+\/tags\/list$/)
		.forHostname(REGISTRY2_HOST)
		.always()
		.thenCallback((req) => {
			const repo = new URL(req.url).pathname.slice(
				'/v2/'.length,
				-'/tags/list'.length,
			);
			const images = getNonDeletedImages(repo);
			if (images.length === 0) {
				return {
					statusCode: 404,
					json: { errors: [{ code: 'NAME_UNKNOWN' }] },
				};
			}
			return {
				statusCode: 200,
				json: {
					name: repo,
					tags: [...new Set(images.flatMap((i) => i.tags ?? []))],
				},
			};
		});

	await server
		.forHead(/\/v2\/.+\/manifests\/.+$/)
		.forHostname(REGISTRY2_HOST)
		.always()
		.thenCallback((req) => {
			const { repo, reference } = parseManifestPath(req.url);
			const image = getNonDeletedImages(repo).find((i) =>
				i.tags?.includes(reference),
			);
			if (image == null) {
				return { statusCode: 404 };
			}
			return {
				statusCode: 200,
				headers: { 'docker-content-digest': image.digest },
			};
		});

	await server
		.forDelete(/\/v2\/.+\/manifests\/.+$/)
		.forHostname(REGISTRY2_HOST)
		.always()
		.thenCallback((req) => {
			const { repo, reference } = parseManifestPath(req.url);
			const image = getNonDeletedImages(repo).find(
				(i) => i.digest === reference,
			);
			if (image == null) {
				return { statusCode: 404 };
			}
			image.isDeleted = true;
			return { statusCode: 202 };
		});
}

let disposeS3Resolver: (() => void) | undefined;
let disposeDeleteObjectsResolver: (() => void) | undefined;

export async function start() {
	disposeS3Resolver = registerS3Resolver();
	disposeDeleteObjectsResolver = registerDeleteObjectsResolver();
	await startRegistryApi();
}

export function stop() {
	reset();
	disposeS3Resolver?.();
	disposeS3Resolver = undefined;
	disposeDeleteObjectsResolver?.();
	disposeDeleteObjectsResolver = undefined;
}

import {
	REGISTRY2_HOST,
	REGISTRY_STORAGE_ROOT_PATH,
} from '../../src/lib/config.js';
import { getMockServer } from './mockttp-server.js';
import { strict } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { addListObjectsV2Resolver } from './aws-mock.js';

interface RegistryImage {
	repository: string;
	digest: string;
	isDeleted: boolean;
	tags?: string[];
}

const store: {
	images: RegistryImage[];
} = {
	images: [],
};

export function reset() {
	store.images = [];
}

export function genDigest() {
	return `sha256:${randomUUID().replace(/-/g, '').toLowerCase()}`;
}

export function addImage(repository: string, digest: string, tags?: string[]) {
	const registryImage: RegistryImage = {
		repository,
		digest,
		isDeleted: false,
		...(tags != null && { tags }),
	};
	store.images.push(registryImage);
	return registryImage;
}

export function deleteImage(image: RegistryImage) {
	store.images = store.images.filter(
		(i) => i.repository !== image.repository || i.digest !== image.digest,
	);
}

export function getImage(repository: string, digest: string) {
	return store.images.find(
		(i) => i.repository === repository && i.digest === digest,
	);
}

export function addCacheImages(repository: string, stages: number) {
	const cacheImages: RegistryImage[] = [];
	for (let i = 0; i < stages; i++) {
		const cacheRepo = `${repository}-${i}`;
		const cacheImage: RegistryImage = {
			repository: cacheRepo,
			digest: genDigest(),
			isDeleted: false,
		};
		store.images.push(cacheImage);
		cacheImages.push(cacheImage);
	}
	return cacheImages;
}

let nextDeleteResponseCode: number | null = null;
export function setNextDeleteResponseCode(code: number | null) {
	nextDeleteResponseCode = code;
}

const manifestPathRegex =
	/\/v2\/([a-zA-Z0-9-/]+)\/manifests\/(sha256:[a-zA-Z0-9]+)/;

async function mockDeleteManifest() {
	await getMockServer()
		.forDelete(manifestPathRegex)
		.forHostname(REGISTRY2_HOST)
		.always()
		.thenCallback((req) => {
			if (nextDeleteResponseCode != null) {
				const code = nextDeleteResponseCode;
				nextDeleteResponseCode = null;
				return { statusCode: code, body: 'mock error' };
			}
			const matches = req.url.match(manifestPathRegex);
			const repository = matches?.[1];
			const digest = matches?.[2];
			strict(repository && digest);
			const image = getImage(repository, digest);
			if (image == null || image.isDeleted === true) {
				return { statusCode: 404 };
			}
			image.isDeleted = true;
			return { statusCode: 202 };
		});
}

function registerS3Resolver() {
	const reposPath = `${REGISTRY_STORAGE_ROOT_PATH}/repositories/`;
	const digestsPrefixRegex = new RegExp(
		`^${reposPath}(.+?)/_manifests/revisions/sha256/$`,
	);
	const tagDigestsPrefixRegex = new RegExp(
		`^${reposPath}(.+?)/_manifests/tags/(.+?)/index/sha256/$`,
	);
	return addListObjectsV2Resolver((params) => {
		const prefix = params.Prefix ?? '';
		const digestsMatch = prefix.match(digestsPrefixRegex);
		if (digestsMatch) {
			const repo = digestsMatch[1];
			const commonPrefixes = store.images
				.filter((i) => i.repository === repo && !i.isDeleted)
				.map((i) => ({
					Prefix: `${prefix}${i.digest.replace(/^sha256:/, '')}/`,
				}));
			return { IsTruncated: false, CommonPrefixes: commonPrefixes };
		}
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

let disposeS3Resolver: (() => void) | undefined;

export async function start() {
	await mockDeleteManifest();
	disposeS3Resolver = registerS3Resolver();
}

export function stop() {
	reset();
	disposeS3Resolver?.();
	disposeS3Resolver = undefined;
}

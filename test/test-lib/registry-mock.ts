import { REGISTRY2_HOST } from '../../src/lib/config.js';
import nock from 'nock';
import { strict } from 'node:assert';
import type { Image } from '../../src/balena-model.js';

const REGISTRY_ENDPOINT = `https://${REGISTRY2_HOST}`;

interface RegistryImage {
	repo: string;
	manifest: string;
	delete: boolean;
}

const store: {
	images: RegistryImage[];
	digests: Map<string, string>;
} = {
	images: [],
	digests: new Map(),
};

function reset() {
	store.images = [];
	store.digests.clear();
}

function toRegistryImage(
	image: Pick<Image['Read'], 'is_stored_at__image_location' | 'content_hash'>,
) {
	if (image.content_hash == null) {
		throw new Error('content_hash not defined');
	}
	return {
		repo: image.is_stored_at__image_location.replace(`${REGISTRY2_HOST}/`, ''),
		manifest: image.content_hash,
		delete: false,
	};
}

export function addImage(
	image: Pick<Image['Read'], 'is_stored_at__image_location' | 'content_hash'>,
) {
	const registryImage = toRegistryImage(image);
	store.images.push(registryImage);
	return registryImage;
}

export function deleteImage(image: RegistryImage) {
	store.images = store.images.filter(
		(i) => i.repo !== image.repo || i.manifest !== image.manifest,
	);
}

export function getImage(
	image:
		| Pick<RegistryImage, 'repo' | 'manifest'>
		| Pick<Image['Read'], 'is_stored_at__image_location' | 'content_hash'>,
) {
	const { repo, manifest } = 'repo' in image ? image : toRegistryImage(image);

	return store.images.find((i) => i.repo === repo && i.manifest === manifest);
}

export function addCacheImages(
	parentImage: Pick<
		Image['Read'],
		'is_stored_at__image_location' | 'content_hash'
	>,
	stages: number,
) {
	const parent = toRegistryImage(parentImage);
	const cacheImages: RegistryImage[] = [];
	for (let i = 0; i < stages; i++) {
		const cacheRepo = `${parent.repo}-${i}`;
		const digest = `sha256:cache${i}`;
		store.digests.set(cacheRepo, digest);
		const cacheImage: RegistryImage = {
			repo: cacheRepo,
			manifest: digest,
			delete: false,
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

function nockDeleteManifest(): nock.Scope {
	const pathRegex = /\/v2\/([a-zA-Z0-9-_%]+)\/manifests\/(sha256[a-zA-Z0-9%]+)/;
	return nock(REGISTRY_ENDPOINT)
		.delete(pathRegex)
		.reply((uri) => {
			if (nextDeleteResponseCode != null) {
				const code = nextDeleteResponseCode;
				nextDeleteResponseCode = null;
				return [code];
			}

			const matches = uri.match(pathRegex);
			const repo = matches?.[1];
			const manifest = matches?.[2];
			strict(repo && manifest);
			const image = getImage({
				repo: decodeURIComponent(repo),
				manifest: decodeURIComponent(manifest),
			});

			if (image == null || image.delete === true) {
				return [404];
			}

			image.delete = true;
			return [202];
		})
		.persist();
}

function nockGetManifestDigest(): nock.Scope {
	const pathRegex = /\/v2\/([a-zA-Z0-9-_%]+)\/manifests\/latest/;
	return nock(REGISTRY_ENDPOINT)
		.head(pathRegex)
		.reply((uri) => {
			const matches = uri.match(pathRegex);
			const repo = matches?.[1];
			strict(repo);
			const decodedRepo = decodeURIComponent(repo);
			const digest = store.digests.get(decodedRepo);
			if (digest == null) {
				return [404];
			}
			// TODO: Check if this changes for Docker Distribution vs Harbor
			return [200, '', { 'docker-content-digest': digest }];
		})
		.persist();
}

export function start() {
	nockDeleteManifest();
	nockGetManifestDigest();
}

export function stop() {
	reset();
	nock.cleanAll();
}

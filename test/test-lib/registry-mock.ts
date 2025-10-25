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

export const store: {
	images: RegistryImage[];
} = {
	images: [],
};

function toRegistryImage(
	image: Pick<Image['Read'], 'is_stored_at__image_location' | 'content_hash'>,
) {
	if (image.content_hash == null) {
		throw new Error('content_hash not defined');
	}
	return {
		repo: image.is_stored_at__image_location.replace(
			`${REGISTRY2_HOST}/v2/`,
			'',
		),
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
	const index = store.images.findIndex(
		(i) => i.repo === image.repo && i.manifest === image.manifest,
	);
	if (index !== -1) {
		store.images.splice(index, 1);
	}
}

export function getImage(
	image:
		| Pick<RegistryImage, 'repo' | 'manifest'>
		| Pick<Image['Read'], 'is_stored_at__image_location' | 'content_hash'>,
) {
	const { repo, manifest } = 'repo' in image ? image : toRegistryImage(image);

	return store.images.find((i) => i.repo === repo && i.manifest === manifest);
}

export let nextDeleteResponseCode: number | null = null;
export function setNextDeleteResponseCode(code: number | null) {
	nextDeleteResponseCode = code;
}

function nockDeleteManifest(): nock.Scope {
	const pathRegex = /\/v2\/([a-zA-Z0-9-_]+)\/manifests\/(sha256:[a-zA-Z0-9]+)/;
	return nock(REGISTRY_ENDPOINT)
		.delete(pathRegex)
		.reply((uri) => {
			// If nextDeleteResponseCode is set, return it and reset
			if (nextDeleteResponseCode != null) {
				const code = nextDeleteResponseCode;
				nextDeleteResponseCode = null;
				return [code];
			}

			// Parse repo and manifest from URL
			const matches = uri.match(pathRegex);
			const repo = matches?.[1];
			const manifest = matches?.[2];
			strict(repo && manifest);
			const image = getImage({ repo, manifest });

			if (image == null) {
				return [404];
			}

			image.delete = true;
			return [202];
		})
		.persist();
}

export function start() {
	nockDeleteManifest();
}

export function stop() {
	nock.cleanAll();
}

import { S3 } from '@aws-sdk/client-s3';
import _ from 'lodash';
import path from 'path';

import {
	IMAGE_STORAGE_ACCESS_KEY,
	IMAGE_STORAGE_BUCKET as S3_BUCKET,
	IMAGE_STORAGE_ENDPOINT,
	IMAGE_STORAGE_FORCE_PATH_STYLE,
	IMAGE_STORAGE_SECRET_KEY,
} from '../../../lib/config.js';

export const getKey = (...parts: string[]): string => parts.join('/');

const s3Client = new S3({
	// The transformation for endpoint is not implemented.
	// Refer to UPGRADING.md on aws-sdk-js-v3 for changes needed.
	// Please create/upvote feature request on aws-sdk-js-codemod for endpoint.
	endpoint: IMAGE_STORAGE_ENDPOINT,

	region: 'us-east-1',

	// The key s3ForcePathStyle is renamed to forcePathStyle.
	forcePathStyle: IMAGE_STORAGE_FORCE_PATH_STYLE,

	...(!IMAGE_STORAGE_ACCESS_KEY || !IMAGE_STORAGE_SECRET_KEY
		? {
				// makes the requests being unauthenticated
				signer: { sign: async (request) => request },
			}
		: {
				credentials: {
					accessKeyId: IMAGE_STORAGE_ACCESS_KEY,
					secretAccessKey: IMAGE_STORAGE_SECRET_KEY,
				},
			}),
});

async function getFileInfo(s3Path: string) {
	return await s3Client.headObject({
		Bucket: S3_BUCKET,
		Key: s3Path,
	});
}

export async function getFile(s3Path: string) {
	return await s3Client.getObject({
		Bucket: S3_BUCKET,
		Key: s3Path,
	});
}

export async function getFolderSize(
	folder: string,
	marker?: string,
): Promise<number> {
	const res = await s3Client.listObjectsV2({
		Bucket: S3_BUCKET,
		Prefix: `${folder}/`,
		ContinuationToken: marker,
	});

	const size = _.sumBy(res.Contents, 'Size');
	const nextMarker = res.NextContinuationToken;
	if (nextMarker && res.IsTruncated) {
		const newSize = await getFolderSize(folder, nextMarker);
		return size + newSize;
	}
	return size;
}

export async function listFolders(
	folder: string,
	marker?: string,
): Promise<string[]> {
	const res = await s3Client.listObjectsV2({
		Bucket: S3_BUCKET,
		Prefix: `${folder}/`,
		Delimiter: '/',
		ContinuationToken: marker,
	});

	const objects = _(res.CommonPrefixes)
		.map(({ Prefix }) => Prefix)
		// only keep the folder paths (which are ending with `/`)
		.filter((p): p is NonNullable<typeof p> => p != null && p.endsWith('/'))
		.map((p) =>
			// get the name of the immediately contained folder
			path.basename(p),
		)
		.value();
	const nextMarker = res.NextContinuationToken;
	if (nextMarker && res.IsTruncated) {
		const newObjects = await listFolders(folder, nextMarker);
		return objects.concat(newObjects);
	}
	return objects;
}

export async function fileExists(s3Path: string): Promise<boolean> {
	try {
		await getFileInfo(s3Path);
		return true;
	} catch (err) {
		if (err.statusCode === 404) {
			return false;
		}
		throw err;
	}
}

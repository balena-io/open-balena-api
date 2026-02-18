import {
	HeadObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { S3 } from './aws-sdk-wrapper.js';
import _ from 'lodash';
import path from 'path';

import {
	IMAGE_STORAGE_ACCESS_KEY,
	IMAGE_STORAGE_BUCKET as S3_BUCKET,
	IMAGE_STORAGE_ENDPOINT,
	IMAGE_STORAGE_FORCE_PATH_STYLE,
	IMAGE_STORAGE_SECRET_KEY,
	IMAGE_STORAGE_DEBUG_REQUEST_ERRORS,
} from '../../../lib/config.js';

export const getKey = (...parts: string[]): string => parts.join('/');

function createS3Client() {
	if (!IMAGE_STORAGE_ACCESS_KEY || !IMAGE_STORAGE_SECRET_KEY) {
		return new S3({
			endpoint: IMAGE_STORAGE_ENDPOINT,
			forcePathStyle: IMAGE_STORAGE_FORCE_PATH_STYLE,
			// No-op signer to send requests unsigned; without this the SDK
			// would try to resolve credentials and throw CredentialsProviderError.
			signer: { sign: (req) => Promise.resolve(req) },
		});
	}
	return new S3({
		endpoint: IMAGE_STORAGE_ENDPOINT,
		forcePathStyle: IMAGE_STORAGE_FORCE_PATH_STYLE,
		credentials: {
			accessKeyId: IMAGE_STORAGE_ACCESS_KEY,
			secretAccessKey: IMAGE_STORAGE_SECRET_KEY,
		},
	});
}

const s3Client = createS3Client();

function isUnauthenticatedError(err: any): boolean {
	return (
		(!IMAGE_STORAGE_ACCESS_KEY || !IMAGE_STORAGE_SECRET_KEY) &&
		[401, 403].includes(err.$metadata?.httpStatusCode)
	);
}

function logUnauthenticated(pathS3: string, err: any): void {
	if (IMAGE_STORAGE_DEBUG_REQUEST_ERRORS) {
		console.warn(
			`${err.name} (${err.$metadata?.httpStatusCode}): ${pathS3} belongs to a private device type or has incorrect permissions`,
		);
	}
}

async function getFileInfo(s3Path: string) {
	return await s3Client.send(
		new HeadObjectCommand({
			Bucket: S3_BUCKET,
			Key: s3Path,
		}),
	);
}

export async function getFile(s3Path: string) {
	try {
		const response = await s3Client.send(
			new GetObjectCommand({
				Bucket: S3_BUCKET,
				Key: s3Path,
			}),
		);
		const bodyString = await response.Body?.transformToString();
		return { ...response, Body: bodyString };
	} catch (err) {
		if (isUnauthenticatedError(err)) {
			// catch errors for private device types when running unauthenticated
			logUnauthenticated(s3Path, err);
			return;
		}
		if (err.$metadata?.httpStatusCode === 404) {
			return;
		}
		throw err;
	}
}

export async function getFolderSize(
	folder: string,
	keyPattern?: RegExp,
	marker?: string,
): Promise<number> {
	const res = await s3Client.send(
		new ListObjectsV2Command({
			Bucket: S3_BUCKET,
			Prefix: `${folder}/`,
			ContinuationToken: marker,
		}),
	);

	let contents = res.Contents;
	if (contents != null && keyPattern != null) {
		contents = contents.filter((c) => c.Key != null && keyPattern.test(c.Key));
	}

	const size = _.sumBy(contents, 'Size');
	const nextMarker = res.NextContinuationToken;
	if (nextMarker && res.IsTruncated) {
		const newSize = await getFolderSize(folder, keyPattern, nextMarker);
		return size + newSize;
	}
	return size;
}

export async function listFolders(
	folder: string,
	marker?: string,
): Promise<string[]> {
	const res = await s3Client.send(
		new ListObjectsV2Command({
			Bucket: S3_BUCKET,
			Prefix: `${folder}/`,
			Delimiter: '/',
			ContinuationToken: marker,
		}),
	);

	const objects = _(res.CommonPrefixes)
		.map(({ Prefix }) => Prefix)
		// only keep the folder paths (which are ending with `/`)
		.filter((p): p is NonNullable<typeof p> => p?.endsWith('/') === true)
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
		if (isUnauthenticatedError(err)) {
			// catch errors for private device types when running unauthenticated
			logUnauthenticated(s3Path, err);
		} else if (err.$metadata?.httpStatusCode === 404) {
			return false;
		}
		throw err;
	}
}

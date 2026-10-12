import {
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	S3Client,
} from '@aws-sdk/client-s3';
import path from 'path';

import {
	IMAGE_STORAGE_ACCESS_KEY,
	IMAGE_STORAGE_BUCKET as S3_BUCKET,
	IMAGE_STORAGE_ENDPOINT,
	IMAGE_STORAGE_FORCE_PATH_STYLE,
	IMAGE_STORAGE_SECRET_KEY,
	IMAGE_STORAGE_DEBUG_REQUEST_ERRORS,
	IMAGE_STORAGE_REGION,
} from '../../../lib/config.js';

export const getKey = (...parts: string[]): string => parts.join('/');

const isUnauthenticated =
	!IMAGE_STORAGE_ACCESS_KEY || !IMAGE_STORAGE_SECRET_KEY;

function createS3Client() {
	const config = {
		endpoint: IMAGE_STORAGE_ENDPOINT,
		forcePathStyle: IMAGE_STORAGE_FORCE_PATH_STYLE,
		region: IMAGE_STORAGE_REGION,
	};
	if (!IMAGE_STORAGE_ACCESS_KEY || !IMAGE_STORAGE_SECRET_KEY) {
		return new S3Client({
			...config,
			// Send requests unsigned so that public objects can be read without credentials
			signer: { sign: (request) => Promise.resolve(request) },
		});
	}
	return new S3Client({
		...config,
		credentials: {
			accessKeyId: IMAGE_STORAGE_ACCESS_KEY,
			secretAccessKey: IMAGE_STORAGE_SECRET_KEY,
		},
	});
}

const s3Client = createS3Client();

const getStatusCode = (err: any): number | undefined =>
	err.$metadata?.httpStatusCode;

function isUnauthenticatedError(err: any): boolean {
	return isUnauthenticated && [401, 403].includes(getStatusCode(err)!);
}

function logUnauthenticated(pathS3: string, err: any): void {
	if (IMAGE_STORAGE_DEBUG_REQUEST_ERRORS) {
		console.warn(
			`${err.name} (${getStatusCode(err)}): ${pathS3} belongs to a private device type or has incorrect permissions`,
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
		const res = await s3Client.send(
			new GetObjectCommand({
				Bucket: S3_BUCKET,
				Key: s3Path,
			}),
		);
		// The body is a stream that must be consumed to release the connection
		return await res.Body?.transformToString();
	} catch (err) {
		if (isUnauthenticatedError(err)) {
			// catch errors for private device types when running unauthenticated
			logUnauthenticated(s3Path, err);
			return;
		}
		if (getStatusCode(err) === 404) {
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

	const size =
		contents?.reduce((sum, content) => sum + (content.Size ?? 0), 0) ?? 0;
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

	const objects = (res.CommonPrefixes ?? [])
		// get the name of the immediately contained folder
		.map(({ Prefix }) => (Prefix?.endsWith('/') ? path.basename(Prefix) : null))
		// only keep the folder paths (which are ending with `/`)
		.filter((p) => p != null);
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
		} else if (getStatusCode(err) === 404) {
			return false;
		}
		throw err;
	}
}

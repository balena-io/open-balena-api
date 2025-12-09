import AWS from './aws-sdk-wrapper.js';
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

class UnauthenticatedS3Facade {
	constructor(private s3: AWS.S3) {}

	public headObject(
		params: AWS.S3.Types.HeadObjectRequest,
	): ReturnType<AWS.S3['headObject']> {
		return this.s3.makeUnauthenticatedRequest('headObject', params);
	}

	public getObject(
		params: AWS.S3.Types.GetObjectRequest,
	): ReturnType<AWS.S3['getObject']> {
		return this.s3.makeUnauthenticatedRequest('getObject', params);
	}

	public listObjectsV2(
		params: AWS.S3.Types.ListObjectsV2Request,
	): ReturnType<AWS.S3['listObjectsV2']> {
		return this.s3.makeUnauthenticatedRequest('listObjectsV2', params);
	}
}

function createS3Client() {
	if (!IMAGE_STORAGE_ACCESS_KEY || !IMAGE_STORAGE_SECRET_KEY) {
		return new UnauthenticatedS3Facade(
			new AWS.S3({
				endpoint: IMAGE_STORAGE_ENDPOINT,
				s3ForcePathStyle: IMAGE_STORAGE_FORCE_PATH_STYLE,
				signatureVersion: 'v4',
			}),
		);
	}
	return new AWS.S3({
		endpoint: IMAGE_STORAGE_ENDPOINT,
		s3ForcePathStyle: IMAGE_STORAGE_FORCE_PATH_STYLE,
		signatureVersion: 'v4',
		accessKeyId: IMAGE_STORAGE_ACCESS_KEY,
		secretAccessKey: IMAGE_STORAGE_SECRET_KEY,
	});
}

const s3Client = createS3Client();

function isUnauthenticatedError(
	clientS3: UnauthenticatedS3Facade | AWS.S3,
	err: any,
): boolean {
	return (
		clientS3 instanceof UnauthenticatedS3Facade &&
		[401, 403].includes(err.statusCode)
	);
}

function logUnauthenticated(pathS3: string, err: any): void {
	if (IMAGE_STORAGE_DEBUG_REQUEST_ERRORS) {
		console.warn(
			`${err.code} (${err.statusCode}): ${pathS3} belongs to a private device type or has incorrect permissions`,
		);
	}
}

async function getFileInfo(s3Path: string) {
	const req = s3Client.headObject({
		Bucket: S3_BUCKET,
		Key: s3Path,
	});
	return await req.promise();
}

export async function getFile(s3Path: string) {
	try {
		const req = s3Client.getObject({
			Bucket: S3_BUCKET,
			Key: s3Path,
		});
		return await req.promise();
	} catch (err) {
		if (isUnauthenticatedError(s3Client, err)) {
			// catch errors for private device types when running unauthenticated
			logUnauthenticated(s3Path, err);
			return;
		}
		if (err.statusCode === 404) {
			return;
		}
		throw err;
	}
}

export async function getFolderSize(
	folder: string,
	marker?: string,
): Promise<number> {
	const req = s3Client.listObjectsV2({
		Bucket: S3_BUCKET,
		Prefix: `${folder}/`,
		ContinuationToken: marker,
	});
	const res = await req.promise();

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
	const req = s3Client.listObjectsV2({
		Bucket: S3_BUCKET,
		Prefix: `${folder}/`,
		Delimiter: '/',
		ContinuationToken: marker,
	});

	const res = await req.promise();

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
		if (isUnauthenticatedError(s3Client, err)) {
			// catch errors for private device types when running unauthenticated
			logUnauthenticated(s3Path, err);
		} else if (err.statusCode === 404) {
			return false;
		}
		throw err;
	}
}

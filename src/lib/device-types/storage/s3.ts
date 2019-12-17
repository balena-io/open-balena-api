import * as AWS from 'aws-sdk';
import * as path from 'path';
import * as _ from 'lodash';
import {
	IMAGE_STORAGE_BUCKET as S3_BUCKET,
	IMAGE_STORAGE_ENDPOINT,
	IMAGE_STORAGE_FORCE_PATH_STYLE,
	IMAGE_STORAGE_ACCESS_KEY,
	IMAGE_STORAGE_SECRET_KEY,
} from '../../config';

export const getKey = (...parts: string[]): string => parts.join('/');

class UnauthenticatedS3Facade {
	constructor(private s3Client: AWS.S3) {}

	headObject(
		params: AWS.S3.Types.HeadObjectRequest,
	): ReturnType<AWS.S3['headObject']> {
		return this.s3Client.makeUnauthenticatedRequest('headObject', params);
	}

	getObject(
		params: AWS.S3.Types.GetObjectRequest,
	): ReturnType<AWS.S3['getObject']> {
		return this.s3Client.makeUnauthenticatedRequest('getObject', params);
	}

	listObjectsV2(
		params: AWS.S3.Types.ListObjectsV2Request,
	): ReturnType<AWS.S3['listObjectsV2']> {
		return this.s3Client.makeUnauthenticatedRequest('listObjectsV2', params);
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

function getFileInfo(path: string) {
	const req = s3Client.headObject({
		Bucket: S3_BUCKET,
		Key: path,
	});
	return req.promise();
}

export function getFile(path: string) {
	const req = s3Client.getObject({
		Bucket: S3_BUCKET,
		Key: path,
	});
	return req.promise();
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
		.map('Prefix')
		// only keep the folder paths (which are ending with `/`)
		.filter(p => p != null && p.endsWith('/'))
		.map((p: string) =>
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

export async function fileExists(path: string): Promise<boolean> {
	try {
		await getFileInfo(path);
		return true;
	} catch (err) {
		if (err.statusCode === 404) {
			return false;
		}
		throw err;
	}
}

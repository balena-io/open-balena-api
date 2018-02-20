import * as AWS from 'aws-sdk';
import * as Promise from 'bluebird';
import * as path from 'path';
import * as _ from 'lodash';
import {
	IMAGE_STORAGE_BUCKET as S3_BUCKET,
	IMAGE_STORAGE_ENDPOINT,
	IMAGE_STORAGE_FORCE_PATH_STYLE,
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

const s3Client = new UnauthenticatedS3Facade(
	new AWS.S3({
		endpoint: IMAGE_STORAGE_ENDPOINT,
		s3ForcePathStyle: IMAGE_STORAGE_FORCE_PATH_STYLE,
		signatureVersion: 'v4',
	}),
);

export function getFileInfo(path: string) {
	const req = s3Client.headObject({
		Bucket: S3_BUCKET,
		Key: path,
	});
	return Promise.resolve(req.promise());
}

export function getFile(path: string) {
	const req = s3Client.getObject({
		Bucket: S3_BUCKET,
		Key: path,
	});
	return Promise.resolve(req.promise());
}

export function getFolderSize(
	folder: string,
	marker?: string,
): Promise<number> {
	const req = s3Client.listObjectsV2({
		Bucket: S3_BUCKET,
		Prefix: `${folder}/`,
		ContinuationToken: marker,
	});
	return Promise.resolve(req.promise()).then(res => {
		const size = _.sumBy(res.Contents, 'Size');
		const marker = res.NextContinuationToken;
		if (marker && res.IsTruncated) {
			return getFolderSize(folder, marker).then(newSize => size + newSize);
		}
		return size;
	});
}

export function listFolders(
	folder: string,
	marker?: string,
): Promise<string[]> {
	const req = s3Client.listObjectsV2({
		Bucket: S3_BUCKET,
		Prefix: `${folder}/`,
		Delimiter: '/',
		ContinuationToken: marker,
	});

	return Promise.resolve(req.promise()).then(res => {
		const objects = _(res.CommonPrefixes)
			.map('Prefix')
			// only keep the folder paths (which are ending with `/`)
			.filter(p => p && p.endsWith('/'))
			.map((p: string) =>
				// get the name of the immediately contained folder
				path.basename(p),
			)
			.value();
		const marker = res.NextContinuationToken;
		if (marker && res.IsTruncated) {
			return listFolders(folder, marker).then(newObjects =>
				objects.concat(newObjects),
			);
		}
		return objects;
	});
}

export function fileExists(path: string): Promise<boolean> {
	return getFileInfo(path)
		.return(true)
		.catch(err => {
			if (err.statusCode === 404) {
				return false;
			}
			throw err;
		});
}

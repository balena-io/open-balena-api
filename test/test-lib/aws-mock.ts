import {
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	S3Client,
	S3ServiceException,
} from '@aws-sdk/client-s3';
import type {
	DeleteObjectsCommandInput,
	DeleteObjectsCommandOutput,
	GetObjectCommandInput,
	GetObjectCommandOutput,
	HeadObjectCommandInput,
	ListObjectsV2CommandInput,
	ListObjectsV2CommandOutput,
	ObjectStorageClass,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/util-stream';
import { mockClient } from 'aws-sdk-client-mock';
import { assert } from 'chai';
import _ from 'lodash';
import { Readable } from 'node:stream';
import {
	IMAGE_STORAGE_ACCESS_KEY,
	IMAGE_STORAGE_BUCKET,
	IMAGE_STORAGE_SECRET_KEY,
	REGISTRY_STORAGE_ACCESS_KEY,
	REGISTRY_STORAGE_BUCKET,
	REGISTRY_STORAGE_SECRET_KEY,
} from '../../src/lib/config.js';

type MockedError = {
	Error: {
		statusCode: number;
	};
};

type ListObjectsV2Output = Omit<ListObjectsV2CommandOutput, '$metadata'>;
type DeleteObjectsOutput = Omit<DeleteObjectsCommandOutput, '$metadata'>;
type GetObjectOutput = Omit<GetObjectCommandOutput, '$metadata' | 'Body'> & {
	Body?: string;
};

type ListObjectsV2Resolver = (
	params: ListObjectsV2CommandInput,
) => ListObjectsV2Output | undefined;

const listObjectsV2Resolvers: ListObjectsV2Resolver[] = [];

// Allow test libraries to add specific resolvers.
// Return a disposer function to keep things clean.
export function addListObjectsV2Resolver(resolver: ListObjectsV2Resolver) {
	listObjectsV2Resolvers.push(resolver);
	return () => {
		const idx = listObjectsV2Resolvers.indexOf(resolver);
		if (idx !== -1) {
			listObjectsV2Resolvers.splice(idx, 1);
		}
	};
}

type DeleteObjectsResolver = (
	params: DeleteObjectsCommandInput,
) => DeleteObjectsOutput | undefined;

const deleteObjectsResolvers: DeleteObjectsResolver[] = [];

// Allow test libraries to add specific resolvers.
// Return a disposer function to keep things clean.
export function addDeleteObjectsResolver(resolver: DeleteObjectsResolver) {
	deleteObjectsResolvers.push(resolver);
	return () => {
		const idx = deleteObjectsResolvers.indexOf(resolver);
		if (idx !== -1) {
			deleteObjectsResolvers.splice(idx, 1);
		}
	};
}

export default (
	$getObjectMocks: Record<
		string,
		| (Omit<GetObjectOutput, 'LastModified'> & {
				LastModified?: string;
		  })
		| MockedError
	>,
	$listObjectsV2Mocks: Record<
		string,
		| (Omit<ListObjectsV2Output, 'Contents'> & {
				Contents?: Array<
					Omit<
						NonNullable<ListObjectsV2Output['Contents']>[number],
						'LastModified' | 'StorageClass'
					> & {
						LastModified: string;
						StorageClass?: string;
					}
				>;
		  })
		| MockedError
	>,
) => {
	// AWS S3 Client results have a Date on their LastModified prop
	// so we have to reconstruct them from the strings that the mock object holds
	const getObjectMocks: Record<string, GetObjectOutput | MockedError> =
		_.mapValues(
			$getObjectMocks,
			(
				getObjectMock: (typeof $getObjectMocks)[keyof typeof $getObjectMocks],
			): GetObjectOutput | MockedError => {
				if ('Error' in getObjectMock) {
					return getObjectMock;
				}
				return {
					...getObjectMock,
					LastModified: getObjectMock.LastModified
						? new Date(getObjectMock.LastModified)
						: undefined,
				};
			},
		);
	const listObjectsV2Mocks: Record<string, ListObjectsV2Output | MockedError> =
		_.mapValues(
			$listObjectsV2Mocks,
			(
				listObjectsV2Mock: (typeof $listObjectsV2Mocks)[keyof typeof $listObjectsV2Mocks],
			): ListObjectsV2Output | MockedError => {
				if ('Error' in listObjectsV2Mock) {
					return listObjectsV2Mock;
				}
				return {
					...listObjectsV2Mock,
					Contents: listObjectsV2Mock.Contents?.map((contents) => {
						return {
							...contents,
							LastModified: contents.LastModified
								? new Date(contents.LastModified)
								: undefined,
							StorageClass: contents.StorageClass as ObjectStorageClass,
						};
					}),
				};
			},
		);

	const toS3Error = (statusCode: number) =>
		new S3ServiceException({
			name: statusCode === 404 ? 'NotFound' : String(statusCode),
			$fault: statusCode >= 500 ? 'server' : 'client',
			$metadata: { httpStatusCode: statusCode },
		});

	const resolveMock = <T extends object>(mock: T | MockedError): T => {
		if ('Error' in mock) {
			throw toS3Error(mock.Error.statusCode);
		}
		return mock;
	};

	const assertCredentials = async (client: S3Client) => {
		const credentials = await client.config.credentials();
		if (credentials.accessKeyId === REGISTRY_STORAGE_ACCESS_KEY) {
			assert(
				credentials.secretAccessKey === REGISTRY_STORAGE_SECRET_KEY,
				'Mismatching registry S3 credentials',
			);
		} else if (credentials.accessKeyId === IMAGE_STORAGE_ACCESS_KEY) {
			assert(
				credentials.secretAccessKey === IMAGE_STORAGE_SECRET_KEY,
				'Mismatching image S3 credentials',
			);
		} else {
			throw new Error('Unexpected S3 client credentials');
		}
	};

	const headObject = async (
		params: HeadObjectCommandInput,
		getClient: () => S3Client,
	) => {
		await assertCredentials(getClient());
		const mock = getObjectMocks[params.Key!];
		if (mock) {
			return _.omit(resolveMock(mock), 'Body', 'ContentRange', 'TagCount');
		}

		// treat not found IGNORE file mocks as 404
		if (_.endsWith(params.Key, '/IGNORE')) {
			throw toS3Error(404);
		}

		throw new Error(
			`aws mock: headObject could not find a mock for ${params.Key}`,
		);
	};

	const getObject = async (
		params: GetObjectCommandInput,
		getClient: () => S3Client,
	) => {
		await assertCredentials(getClient());
		const mock = getObjectMocks[params.Key!];
		if (!mock) {
			throw new Error(
				`aws mock: getObject could not find a mock for ${params.Key}`,
			);
		}
		const { Body, ...result } = resolveMock(mock);
		return {
			...result,
			// A new stream is needed per call as they can only be consumed once
			Body:
				Body != null
					? sdkStreamMixin(Readable.from([Buffer.from(Body)]))
					: undefined,
		};
	};

	const listObjectsV2 = async (
		params: ListObjectsV2CommandInput,
		getClient: () => S3Client,
	) => {
		await assertCredentials(getClient());
		for (const resolver of listObjectsV2Resolvers) {
			const result = resolver(params);
			if (result != null) {
				return result;
			}
		}
		const mock = listObjectsV2Mocks[params.Prefix!];
		if (!mock) {
			throw new Error(
				`aws mock: listObjectsV2 could not find a mock for ${params.Prefix}`,
			);
		}
		return resolveMock(mock);
	};

	const deleteObjects = async (
		params: DeleteObjectsCommandInput,
		getClient: () => S3Client,
	) => {
		await assertCredentials(getClient());
		for (const resolver of deleteObjectsResolvers) {
			const result = resolver(params);
			if (result != null) {
				return result;
			}
		}
		throw new Error(
			`aws mock: deleteObjects could not find a resolver for ${params.Bucket}`,
		);
	};

	// This stubs `send` for every S3Client in the process, including ones used by
	// dependencies (eg the pinejs webresource handler), so only intercept commands
	// for the buckets we mock and let everything else through to the real client.
	const s3Mock = mockClient(S3Client);
	s3Mock.send.callThrough();

	const mockedBuckets = [IMAGE_STORAGE_BUCKET, REGISTRY_STORAGE_BUCKET].filter(
		(bucket) => bucket != null,
	);
	for (const Bucket of mockedBuckets) {
		// Registered first so that the command specific mocks take precedence
		s3Mock
			.onAnyCommand({ Bucket })
			.callsFake((_input, getClient: () => S3Client) =>
				assertCredentials(getClient()).then(() => {
					throw new Error(`AWS Mock: Operation isn't implemented`);
				}),
			);
		s3Mock.on(HeadObjectCommand, { Bucket }).callsFake(headObject);
		s3Mock.on(GetObjectCommand, { Bucket }).callsFake(getObject);
		s3Mock.on(ListObjectsV2Command, { Bucket }).callsFake(listObjectsV2);
		s3Mock.on(DeleteObjectsCommand, { Bucket }).callsFake(deleteObjects);
	}
};

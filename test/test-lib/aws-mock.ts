import {
	DeleteObjectsCommand,
	GetObjectCommand,
	HeadObjectCommand,
	ListObjectsV2Command,
	NoSuchKey,
	NotFound,
	S3ServiceException,
} from '@aws-sdk/client-s3';
import type {
	DeleteObjectsOutput,
	DeleteObjectsRequest,
	GetObjectCommandOutput,
	GetObjectOutput,
	GetObjectRequest,
	HeadObjectRequest,
	ListObjectsV2Output,
	ListObjectsV2Request,
	S3ClientConfig,
} from '@aws-sdk/client-s3';
import { sdkStreamMixin } from '@smithy/core/serde';
import type { AwsCredentialIdentity } from '@smithy/types';
import { assert } from 'chai';
import _ from 'lodash';
import { Readable } from 'node:stream';
import {
	IMAGE_STORAGE_ACCESS_KEY,
	IMAGE_STORAGE_SECRET_KEY,
	REGISTRY_STORAGE_ACCESS_KEY,
	REGISTRY_STORAGE_SECRET_KEY,
} from '../../src/lib/config.js';
import { TEST_MOCK_ONLY } from '../../src/features/device-types/storage/aws-sdk-wrapper.js';

type MockedError = {
	Error: {
		statusCode: number;
	};
};

const isMockedError = (mock: object): mock is MockedError => 'Error' in mock;

type ListObjectsV2Resolver = (
	params: ListObjectsV2Request,
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
	params: DeleteObjectsRequest,
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
		| (Omit<GetObjectOutput, 'LastModified' | 'Body'> & {
				LastModified?: string;
				Body?: string;
		  })
		| MockedError
	>,
	$listObjectsV2Mocks: Record<
		string,
		| (Omit<ListObjectsV2Output, 'Contents'> & {
				Contents?: Array<
					Omit<ListObjectsV2Output['Contents'], 'LastModified'> & {
						LastModified: string;
					}
				>;
		  })
		| MockedError
	>,
) => {
	// AWS S3 Client results have a Date on their LastModified prop so we have to
	// reconstruct them from the strings that the mock object holds. The Body is
	// deliberately left as a string, since it has to be turned into a fresh
	// single-use stream on every request.
	const getObjectMocks: Record<
		string,
		(Omit<GetObjectOutput, 'Body'> & { Body?: string }) | MockedError
	> = _.mapValues($getObjectMocks, (getObjectMock) => {
		if (isMockedError(getObjectMock)) {
			return getObjectMock;
		}
		return {
			...getObjectMock,

			LastModified: getObjectMock.LastModified
				? new Date(getObjectMock.LastModified)
				: undefined,
		};
	});
	const listObjectsV2Mocks: Record<string, ListObjectsV2Output | MockedError> =
		_.mapValues($listObjectsV2Mocks, (listObjectsV2Mock) => {
			if (isMockedError(listObjectsV2Mock)) {
				return listObjectsV2Mock;
			}
			return {
				...listObjectsV2Mock,

				Contents: listObjectsV2Mock.Contents?.map((contents) => {
					return {
						...contents,
						LastModified:
							'LastModified' in contents && contents.LastModified
								? new Date(contents.LastModified)
								: undefined,
					};
				}),
			};
		});

	type S3Op = 'GetObject' | 'HeadObject' | 'ListObjectsV2' | 'DeleteObjects';

	// The fixtures hold the v2 `{ Error: { statusCode } }` shape, which we map
	// onto what v3 code inspects: `err.$metadata.httpStatusCode` and `err.name`.
	const toServiceError = (statusCode: number, op: S3Op): Error => {
		const $metadata = { httpStatusCode: statusCode };
		if (statusCode === 404) {
			// HeadObject 404s surface as `NotFound`, GetObject 404s as `NoSuchKey`
			return op === 'HeadObject'
				? new NotFound({ $metadata, message: 'NotFound' })
				: new NoSuchKey({
						$metadata,
						message: 'The specified key does not exist.',
					});
		}
		const name =
			statusCode === 403
				? 'AccessDenied'
				: statusCode === 401
					? 'Unauthorized'
					: 'InternalError';
		return new S3ServiceException({
			name,
			$fault: statusCode >= 500 ? 'server' : 'client',
			$metadata,
			message: name,
		});
	};

	// A v3 Body is a single-use stream, so it has to be built per request rather
	// than once per fixture. An empty Body has to collect back to '' so that an
	// empty device-type.json keeps counting as a missing one.
	const toBody = (body: string | undefined) =>
		sdkStreamMixin(
			Readable.from(body ? [Buffer.from(body)] : []),
		) as NonNullable<GetObjectCommandOutput['Body']>;

	const ok = <T extends object>(output: T) => ({
		...output,
		$metadata: { httpStatusCode: 200, attempts: 1, totalRetryDelay: 0 },
	});

	class S3ClientMock {
		constructor(config: S3ClientConfig) {
			const credentials = config.credentials as
				AwsCredentialIdentity | undefined;
			if (credentials?.accessKeyId === REGISTRY_STORAGE_ACCESS_KEY) {
				assert(
					credentials?.secretAccessKey === REGISTRY_STORAGE_SECRET_KEY,
					'Mismatching registry S3 credentials',
				);
			} else if (credentials?.accessKeyId === IMAGE_STORAGE_ACCESS_KEY) {
				assert(
					credentials?.secretAccessKey === IMAGE_STORAGE_SECRET_KEY,
					'Mismatching image S3 credentials',
				);
			} else if (credentials?.accessKeyId !== '') {
				// an empty accessKeyId is the unauthenticated client
				throw new Error('Unexpected S3 client credentials');
			}
		}

		// eslint-disable-next-line @typescript-eslint/require-await -- We need to return a promise for mocking reasons but we don't need to await.
		public async send(command: unknown) {
			if (command instanceof HeadObjectCommand) {
				return this.headObject(command.input);
			}
			if (command instanceof GetObjectCommand) {
				return this.getObject(command.input);
			}
			if (command instanceof ListObjectsV2Command) {
				return this.listObjectsV2(command.input);
			}
			if (command instanceof DeleteObjectsCommand) {
				return this.deleteObjects(command.input);
			}
			throw new Error(
				`aws mock: Operation ${(command as any)?.constructor?.name} isn't implemented`,
			);
		}

		private headObject(params: HeadObjectRequest) {
			const mock = getObjectMocks[params.Key!];
			if (mock) {
				if (isMockedError(mock)) {
					throw toServiceError(mock.Error.statusCode, 'HeadObject');
				}
				// HeadObjectOutput holds no Body/ContentRange/TagCount
				return ok(_.omit(mock, 'Body', 'ContentRange', 'TagCount'));
			}

			// treat not found IGNORE file mocks as 404
			if (params.Key?.endsWith('/IGNORE')) {
				throw toServiceError(404, 'HeadObject');
			}

			throw new Error(
				`aws mock: headObject could not find a mock for ${params.Key}`,
			);
		}

		private getObject(params: GetObjectRequest) {
			const mock = getObjectMocks[params.Key!];
			if (!mock) {
				throw new Error(
					`aws mock: getObject could not find a mock for ${params.Key}`,
				);
			}
			if (isMockedError(mock)) {
				throw toServiceError(mock.Error.statusCode, 'GetObject');
			}
			return ok({ ...mock, Body: toBody(mock.Body) });
		}

		private listObjectsV2(params: ListObjectsV2Request) {
			for (const resolver of listObjectsV2Resolvers) {
				const result = resolver(params);
				if (result != null) {
					return ok(result);
				}
			}
			const mock = listObjectsV2Mocks[params.Prefix!];
			if (!mock) {
				throw new Error(
					`aws mock: listObjectsV2 could not find a mock for ${params.Prefix}`,
				);
			}
			if (isMockedError(mock)) {
				throw toServiceError(mock.Error.statusCode, 'ListObjectsV2');
			}
			return ok(mock);
		}

		private deleteObjects(params: DeleteObjectsRequest) {
			for (const resolver of deleteObjectsResolvers) {
				const result = resolver(params);
				if (result != null) {
					return ok(result);
				}
			}
			throw new Error(
				`aws mock: deleteObjects could not find a resolver for ${params.Bucket}`,
			);
		}
	}

	// The mock only implements the promise-returning overload of `send`.
	TEST_MOCK_ONLY.S3Client = S3ClientMock;
};

import type {
	GetObjectOutput,
	HeadObjectOutput,
	ListObjectsV2Output,
	S3Client,
	S3ClientConfig,
} from '@aws-sdk/client-s3';
import {
	HeadObjectCommand,
	GetObjectCommand,
	ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { assert } from 'chai';
import _ from 'lodash';
import {
	IMAGE_STORAGE_ACCESS_KEY,
	IMAGE_STORAGE_SECRET_KEY,
} from '../../src/lib/config.js';
import { TEST_MOCK_ONLY } from '../../src/features/device-types/storage/aws-sdk-wrapper.js';

type MockedError = {
	Error: {
		statusCode: number;
	};
};

export default (
	$getObjectMocks: Dictionary<
		| (Omit<GetObjectOutput, 'LastModified' | 'Body'> & {
				LastModified?: string;
				Body?: string;
		  })
		| MockedError
	>,
	$listObjectsV2Mocks: Dictionary<
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
	// AWS S3 Client getObject results have a Buffer on their Body prop
	// and a Date on their LastModified prop so we have to reconstruct
	// them from the strings that the mock object holds
	const getObjectMocks: Dictionary<GetObjectOutput | MockedError> = _.mapValues(
		$getObjectMocks,
		(
			getObjectMock: (typeof $getObjectMocks)[keyof typeof $getObjectMocks],
		): GetObjectOutput | MockedError => {
			if ('Error' in getObjectMock) {
				return getObjectMock;
			}
			return {
				...getObjectMock,

				Body: getObjectMock.Body
					? ({
							transformToString: () => Promise.resolve(getObjectMock.Body!),
						} as unknown as GetObjectOutput['Body'])
					: undefined,
				LastModified: getObjectMock.LastModified
					? new Date(getObjectMock.LastModified)
					: undefined,
			};
		},
	);
	const listObjectsV2Mocks: Dictionary<ListObjectsV2Output | MockedError> =
		_.mapValues(
			$listObjectsV2Mocks,
			(
				listObjectsV2Mock: (typeof $listObjectsV2Mocks)[keyof typeof $listObjectsV2Mocks],
			): ListObjectsV2Output | MockedError => {
				return {
					...listObjectsV2Mock,

					Contents:
						'Contents' in listObjectsV2Mock && listObjectsV2Mock.Contents
							? listObjectsV2Mock.Contents.map((contents) => {
									return {
										...contents,
										LastModified:
											'LastModified' in contents && contents.LastModified
												? new Date(contents.LastModified)
												: undefined,
									};
								})
							: undefined,
				};
			},
		);

	class NotFoundError extends Error {
		public $metadata = { httpStatusCode: 404 };

		constructor() {
			super('NotFound');
		}
	}

	function throwMockedError(mockedError: MockedError): never {
		const error = new Error();
		Object.assign(error, {
			$metadata: { httpStatusCode: mockedError.Error.statusCode },
		});
		throw error;
	}

	class S3Mock {
		constructor(params: S3ClientConfig) {
			const creds = params.credentials as
				| { accessKeyId: string; secretAccessKey: string }
				| undefined;
			assert(
				creds?.accessKeyId === IMAGE_STORAGE_ACCESS_KEY,
				'S3 access key not matching',
			);
			assert(
				creds?.secretAccessKey === IMAGE_STORAGE_SECRET_KEY,
				'S3 secret key not matching',
			);
		}

		send(command: unknown) {
			if (command instanceof HeadObjectCommand) {
				return this.headObject(command.input);
			}
			if (command instanceof GetObjectCommand) {
				return this.getObject(command.input);
			}
			if (command instanceof ListObjectsV2Command) {
				return this.listObjectsV2(command.input);
			}
			throw new Error(`AWS Mock: Command type isn't implemented`);
		}

		private headObject(params: {
			Bucket?: string;
			Key?: string;
		}): HeadObjectOutput {
			const mock = getObjectMocks[params.Key as keyof typeof getObjectMocks];
			if (mock) {
				if ('Error' in mock && mock.Error) {
					throwMockedError(mock);
				}
				const trimmedMock = _.omit(mock, 'Body', 'ContentRange', 'TagCount');
				return trimmedMock as HeadObjectOutput;
			}

			// treat not found IGNORE file mocks as 404
			if (_.endsWith(params.Key, '/IGNORE')) {
				throw new NotFoundError();
			}

			throw new Error(
				`aws mock: headObject could not find a mock for ${params.Key}`,
			);
		}

		private getObject(params: {
			Bucket?: string;
			Key?: string;
		}): GetObjectOutput {
			const mock = getObjectMocks[params.Key as keyof typeof getObjectMocks];
			if (!mock) {
				throw new Error(
					`aws mock: getObject could not find a mock for ${params.Key}`,
				);
			}
			if ('Error' in mock && mock.Error) {
				throwMockedError(mock);
			}
			return mock as GetObjectOutput;
		}

		private listObjectsV2(params: {
			Bucket?: string;
			Prefix?: string;
			Delimiter?: string;
			ContinuationToken?: string;
		}): ListObjectsV2Output {
			const mock =
				listObjectsV2Mocks[params.Prefix as keyof typeof listObjectsV2Mocks];
			if (!mock) {
				throw new Error(
					`aws mock: listObjectsV2 could not find a mock for ${params.Prefix}`,
				);
			}
			if ('Error' in mock && mock.Error) {
				throwMockedError(mock);
			}
			return mock as ListObjectsV2Output;
		}
	}

	TEST_MOCK_ONLY.S3 = S3Mock as unknown as typeof S3Client;
};

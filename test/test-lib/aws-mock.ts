import type {
	GetObjectCommandInput,
	GetObjectCommandOutput,
	HeadObjectCommandInput,
	ListObjectsV2CommandInput,
	S3,
	S3ClientConfig,
} from '@aws-sdk/client-s3';
import Bluebird from 'bluebird';
import { assert } from 'chai';
import _ from 'lodash';
import mockery from 'mockery';
import {
	IMAGE_STORAGE_ACCESS_KEY,
	IMAGE_STORAGE_SECRET_KEY,
} from '../../src/lib/config.js';

import $getObjectMocks from '../fixtures/s3/getObject.json' assert { type: 'json' };
import listObjectsV2Mocks from '../fixtures/s3/listObjectsV2.json' assert { type: 'json' };

// AWS S3 Client getObject results have a Buffer on their Body prop
// and a Date on their LastModified prop so we have to reconstruct
// them from the strings that the mock object holds
const getObjectMocks: Dictionary<GetObjectCommandOutput> = _.mapValues(
	$getObjectMocks,
	(
		getObjectMock: (typeof $getObjectMocks)[keyof typeof $getObjectMocks],
	): GetObjectCommandOutput => {
		return {
			...getObjectMock,

			Body:
				'Body' in getObjectMock && getObjectMock.Body
					? ({
							async transformToString() {
								return Buffer.from(getObjectMock.Body).toString();
							},
						} as GetObjectCommandOutput['Body'])
					: undefined,
			LastModified:
				'LastModified' in getObjectMock && getObjectMock.LastModified
					? new Date(getObjectMock.LastModified)
					: undefined,
			$metadata: {},
		};
	},
);

class NotFoundError extends Error {
	public statusCode = 404;

	constructor() {
		super('NotFound');
	}
}

const toReturnType = <T extends (...args: any[]) => any>(result: {
	[key: string]: any;
}) => {
	return {
		promise: () => {
			if (result.Error) {
				const error = new Error();
				Object.assign(error, result.Error);

				return Bluebird.reject(error);
			}
			return Bluebird.resolve(result);
		},
	} as unknown as ReturnType<T>;
};

// interface UnauthenticatedRequestParams {
// 	[key: string]: any;
// }

class S3Mock {
	constructor(params: S3ClientConfig) {
		assert(
			'accessKeyId' in params &&
				params.accessKeyId === IMAGE_STORAGE_ACCESS_KEY,
			'S3 access key not matching',
		);
		assert(
			'secretAccessKey' in params &&
				params.secretAccessKey === IMAGE_STORAGE_SECRET_KEY,
			'S3 secret key not matching',
		);
	}

	// public makeUnauthenticatedRequest(
	// 	operation: string,
	// 	params?: UnauthenticatedRequestParams,
	// ): AWS.Request<any, AWS.AWSError> {
	// 	if (operation === 'headObject') {
	// 		return this.headObject(params as HeadObjectCommandInput);
	// 	}
	// 	if (operation === 'getObject') {
	// 		return this.getObject(params as GetObjectCommandInput);
	// 	}
	// 	if (operation === 'listObjectsV2') {
	// 		return this.listObjectsV2(params as ListObjectsV2CommandInput);
	// 	}
	// 	throw new Error(`AWS Mock: Operation ${operation} isn't implemented`);
	// }

	public headObject(
		params: HeadObjectCommandInput,
	): ReturnType<S3['headObject']> {
		const mock = getObjectMocks[params.Key as keyof typeof getObjectMocks];
		if (mock) {
			const trimmedMock = _.omit(mock, 'Body', 'ContentRange', 'TagCount');
			return toReturnType<S3['headObject']>(trimmedMock);
		}

		// treat not found IGNORE file mocks as 404
		if (_.endsWith(params.Key, '/IGNORE')) {
			return toReturnType<S3['headObject']>(
				Bluebird.reject(new NotFoundError()),
			);
		}

		throw new Error(
			`aws mock: headObject could not find a mock for ${params.Key}`,
		);
	}

	public getObject(params: GetObjectCommandInput): ReturnType<S3['getObject']> {
		const mock = getObjectMocks[params.Key as keyof typeof getObjectMocks];
		if (!mock) {
			throw new Error(
				`aws mock: getObject could not find a mock for ${params.Key}`,
			);
		}
		return toReturnType<S3['getObject']>(mock);
	}

	public listObjectsV2(
		params: ListObjectsV2CommandInput,
	): ReturnType<S3['listObjectsV2']> {
		const mock =
			listObjectsV2Mocks[params.Prefix as keyof typeof listObjectsV2Mocks];
		if (!mock) {
			throw new Error(
				`aws mock: listObjectsV2 could not find a mock for ${params.Prefix}`,
			);
		}
		return toReturnType<S3['listObjectsV2']>(mock);
	}
}

export const AWSSdkMock = {
	S3: S3Mock,
};

mockery.enable({ warnOnUnregistered: false });
mockery.registerMock('aws-sdk', AWSSdkMock);

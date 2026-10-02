// We wrap the S3 client construction so that we can mock it in tests.
import { S3Client } from '@aws-sdk/client-s3';
import type { S3ClientConfig } from '@aws-sdk/client-s3';
import { guardTestMockOnly } from '../../../lib/config.js';

// The only part of the client surface we use, and so the only part a mock has
// to implement.
export type S3ClientLike = Pick<S3Client, 'send'>;
export type S3ClientConstructor = new (config: S3ClientConfig) => S3ClientLike;

let S3ClientImpl: S3ClientConstructor = S3Client;

// aws-sdk v2 accepted a bare hostname and assumed https, v3 needs a full URL.
const getEndpointFromHost = (host: string): string =>
	host.startsWith('http') ? host : `https://${host}`;

export const createS3Client = ({
	endpoint,
	...config
}: S3ClientConfig & { endpoint: string }): S3ClientLike =>
	new S3ClientImpl({ ...config, endpoint: getEndpointFromHost(endpoint) });

// aws-sdk v3 dropped `makeUnauthenticatedRequest`, so an anonymous client is
// instead one with a pass-through signer. The blank credentials are still
// needed to keep the SDK from running the credential provider chain.
export const anonymousAuth = {
	credentials: { accessKeyId: '', secretAccessKey: '' },
	signer: { sign: (request) => Promise.resolve(request) },
} satisfies S3ClientConfig;

export const TEST_MOCK_ONLY = {
	set S3Client(v: S3ClientConstructor) {
		guardTestMockOnly();
		S3ClientImpl = v;
	},
};

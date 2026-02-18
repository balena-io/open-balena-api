// We re-export S3Client so that we can mock it in tests.
import { S3Client } from '@aws-sdk/client-s3';
import { guardTestMockOnly } from '../../../lib/config.js';

export let S3 = S3Client;

export const TEST_MOCK_ONLY = {
	set S3(v: typeof S3Client) {
		guardTestMockOnly();
		S3 = v;
	},
};

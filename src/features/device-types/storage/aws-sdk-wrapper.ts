// We import/re-export the aws-sdk so that we can mock it in tests.
import AWS from 'aws-sdk';
import { guardTestMockOnly } from '../../../lib/config.js';

export default AWS;

export const TEST_MOCK_ONLY = {
	set S3(v: typeof AWS.S3) {
		guardTestMockOnly();
		AWS.S3 = v;
	},
};

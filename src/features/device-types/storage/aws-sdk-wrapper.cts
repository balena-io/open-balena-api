// We import/re-export the aws-sdk from a cts file so that mockery can work with it
import AWS from 'aws-sdk';
export { AWS };

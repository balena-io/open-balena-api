import type { webResourceHandler } from '@balena/pinejs';
import type { CloudFrontHandlerProps } from '@balena/pinejs-webresource-cloudfront';
import { CloudFrontHandler } from '@balena/pinejs-webresource-cloudfront';
import type { S3HandlerProps } from '@balena/pinejs-webresource-s3';
import { S3Handler } from '@balena/pinejs-webresource-s3';
import * as fs from 'fs';

import {
	WEBRESOURCES_S3_ACCESS_KEY,
	WEBRESOURCES_S3_SECRET_KEY,
	WEBRESOURCES_S3_REGION,
	WEBRESOURCES_S3_HOST,
	WEBRESOURCES_S3_BUCKET,
	WEBRESOURCES_S3_MAX_FILESIZE,
	WEBRESOURCES_CLOUDFRONT_PRIVATEKEY_PATH,
	WEBRESOURCES_CLOUDFRONT_PUBLICKEY,
	WEBRESOURCES_CLOUDFRONT_HOST,
} from './lib/config.js';

const getEndpointFromHost = (host: string): string => {
	return host.startsWith('http') ? host : `https://${host}`;
};

const getS3Config = (): S3HandlerProps | undefined => {
	if (
		WEBRESOURCES_S3_ACCESS_KEY != null &&
		WEBRESOURCES_S3_SECRET_KEY != null &&
		WEBRESOURCES_S3_REGION != null &&
		WEBRESOURCES_S3_HOST != null &&
		WEBRESOURCES_S3_BUCKET != null
	) {
		return {
			endpoint: getEndpointFromHost(WEBRESOURCES_S3_HOST),
			accessKey: WEBRESOURCES_S3_ACCESS_KEY,
			secretKey: WEBRESOURCES_S3_SECRET_KEY,
			region: WEBRESOURCES_S3_REGION,
			bucket: WEBRESOURCES_S3_BUCKET,
			maxSize: WEBRESOURCES_S3_MAX_FILESIZE,
		};
	}
};

const getCloudfrontConfig = (): CloudFrontHandlerProps | undefined => {
	const s3Config = getS3Config();
	if (
		s3Config != null &&
		WEBRESOURCES_CLOUDFRONT_PRIVATEKEY_PATH != null &&
		WEBRESOURCES_CLOUDFRONT_PUBLICKEY != null &&
		WEBRESOURCES_CLOUDFRONT_HOST != null
	) {
		let cfSecretKey: string;
		try {
			cfSecretKey = fs.readFileSync(
				WEBRESOURCES_CLOUDFRONT_PRIVATEKEY_PATH,
				'utf-8',
			);
		} catch (e) {
			console.error('Failed to start cloudfront with error', e);
			return;
		}

		return {
			cfDistributionDomain: getEndpointFromHost(WEBRESOURCES_CLOUDFRONT_HOST),
			cfPublicKeyId: WEBRESOURCES_CLOUDFRONT_PUBLICKEY,
			cfSecretKey,
			...s3Config,
		};
	}
};

let handler: webResourceHandler.WebResourceHandler | undefined;
export const getFileUploadHandler = () => {
	if (handler == null) {
		const cfConfig = getCloudfrontConfig();
		if (cfConfig != null) {
			handler = new CloudFrontHandler(cfConfig);
			console.log('Successfully initialised webresource CloudFront handler.');
			console.log({
				region: cfConfig.region,
				endpoint: cfConfig.endpoint,
				bucket: cfConfig.bucket,
				cfHost: cfConfig.cfDistributionDomain,
			});
			return handler;
		}

		const s3Config = getS3Config();
		if (s3Config != null) {
			handler = new S3Handler(s3Config);
			console.log('Successfully initialised webresource S3 handler.');
			console.log({
				region: s3Config.region,
				endpoint: s3Config.endpoint,
				bucket: s3Config.bucket,
			});
			return handler;
		}

		console.log('No webresource handler loaded.');
	}
	return handler;
};

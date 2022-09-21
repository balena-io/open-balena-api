import { hooks, permissions, sbvrUtils } from '@balena/pinejs';
import type * as Express from 'express';
import { putFile } from '../../../lib/s3';
import * as _ from 'lodash';

export interface S3Upload {
	url: string;
	name: string;
}

export const s3ImageUpload = async (
	{ files }: Express.Request,
	modelName: string,
	modelId: string,
	fieldName: string,
): Promise<S3Upload> => {
	if (!files) {
		return Promise.resolve({ url: '', name: '' });
	}

	const img: any = _.filter(files, (file: any) => file.fieldname === fieldName);
	console.log(
		`Uploading ${JSON.stringify(
			img,
			null,
			2,
		)} to S3 (Key: ${modelName}/${modelId})...`,
	);

	try {
		const s3Upload = await putFile(`${modelName}/${modelId}`, img.buffer);
		return Promise.resolve({ url: s3Upload.Location, name: s3Upload.Key });
	} catch (err) {
		console.error(`Error uploading to S3: ${err}`);
		throw err;
	}
};

const uploadHook = async (
	{
		req,
		result,
		api,
		tx,
	}: sbvrUtils.HookArgs & {
		result: any;
	},
	resourceName: string,
	fieldName: string,
) => {
	try {
		const uploadedArtifact: S3Upload = await s3ImageUpload(
			req as Express.Request,
			resourceName,
			result,
			fieldName,
		);

		console.log(
			`Uploaded ${uploadedArtifact.name} to ${uploadedArtifact.url} :: Result:${result}`,
		);

		// patch resource with S3 image URL
		if (uploadedArtifact.url) {
			console.log(
				`Patching ${resourceName}:${result} with ${uploadedArtifact.url}`,
			);

			await api.patch({
				resource: resourceName,
				passthrough: { req: permissions.root, tx },
				id: result,
				body: {
					[fieldName]: uploadedArtifact.url,
				},
			});
		}
	} catch (err) {
		throw err;
	}
};

for (const method of ['POST', 'PATCH'] as const) {
	hooks.addPureHook(method, 'resin', 'organization', {
		POSTRUN: async (params) => {
			const files = params.req && (params.req as Express.Request).files;
			const logoFile = _.filter(
				files,
				(file: any) => file.fieldname === 'logo',
			);

			if (logoFile.length > 0) {
				// only run when images are uploaded
				try {
					await uploadHook(params, 'organization', 'logo');
				} catch (err) {
					throw err;
				}
			}
		},
	});
}

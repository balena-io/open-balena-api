import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'node:crypto';
import { requestAsync } from '../../src/infra/request-promise/index.js';
import { expect } from 'chai';

export async function checkFileExists(
	url: string,
	timeout = 10000,
	pollInterval = 500,
) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		try {
			const [response] = await requestAsync({ url, method: 'GET' });
			if (response.statusCode !== 200) {
				return false;
			}
		} catch (error) {
			console.error(error);
		}
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
	}
	return true;
}

export async function expectEqualBlobs(url: string, localBlobPath: string) {
	const [response, fileRes] = await requestAsync({
		url,
		method: 'GET',
		encoding: null,
	});

	expect(response.statusCode).to.equal(200);

	const originalFile = await fs.readFile(localBlobPath);
	const diff = originalFile.compare(fileRes);
	expect(diff).to.equal(0);
}

export const createTempFile = async (sizeInBytes: number) => {
	const content = crypto.randomBytes(sizeInBytes);
	const tempFilePath = path.join(os.tmpdir(), `temp-${Date.now()}.tmp`);
	await fs.writeFile(tempFilePath, content, 'utf8');
	return { tempFilePath, content };
};

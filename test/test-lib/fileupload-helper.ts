import * as fs from 'fs/promises';
import { requestAsync } from '../../src/infra/request-promise';
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

	expect(response.statusCode).to.be.eq(200);

	const originalFile = await fs.readFile(localBlobPath);
	const diff = originalFile.compare(fileRes);
	expect(diff).to.be.eq(0);
}

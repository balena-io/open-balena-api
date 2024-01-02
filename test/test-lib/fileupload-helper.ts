import * as fs from 'fs/promises';
import axios from 'axios';
import { expect } from 'chai';

export async function checkFileExists(
	url: string,
	timeout = 10000,
	pollInterval = 500,
) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		try {
			const response = await axios(url, { method: 'GET' });
			if (response.status !== 200) {
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
	const response = await axios(url, {
		method: 'GET',
		responseType: 'blob',
	});

	expect(response.status).to.be.eq(200);

	const originalFile = await fs.readFile(localBlobPath);
	const diff = originalFile.compare(response.data);
	expect(diff).to.be.eq(0);
}

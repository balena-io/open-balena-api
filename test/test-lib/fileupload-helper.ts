import * as fs from 'fs/promises';
import { expect } from 'chai';
import { setTimeout } from 'timers/promises';

export async function checkFileExists(
	url: string,
	timeout = 10000,
	pollInterval = 500,
) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		try {
			const response = await fetch(url);
			if (response.status !== 200) {
				return false;
			}
		} catch (error) {
			console.error(error);
		}
		await setTimeout(pollInterval);
	}
	return true;
}

export async function expectEqualBlobs(url: string, localBlobPath: string) {
	const response = await fetch(url);

	expect(response.status).to.equal(200);

	const fileRes = Buffer.from(await response.arrayBuffer());

	const originalFile = await fs.readFile(localBlobPath);
	const diff = originalFile.compare(fileRes);
	expect(diff).to.equal(0);
}

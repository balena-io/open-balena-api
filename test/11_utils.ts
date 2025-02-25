import { expect } from 'chai';
import { withRetries } from '../src/lib/utils.js';

export default () => {
	describe('Utils', () => {
		it('withRetries should retry before throwing', async () => {
			let calls = 0;
			const func = () => {
				calls += 1;
				return Promise.reject(new Error('Error'));
			};
			try {
				await withRetries(func, 10, 2);
			} catch (err) {
				expect(err.message).to.equal('Error');
				expect(calls).to.equal(3);
			}
		});

		it('withRetries should resolve after a failure', async () => {
			let calls = 0;
			const func = () => {
				calls += 1;
				if (calls === 2) {
					return Promise.reject(new Error('Error'));
				}
				return Promise.resolve('Resolved');
			};

			const res = await withRetries(func, 10, 2);
			expect(res).to.equal('Resolved');
		});
	});
};

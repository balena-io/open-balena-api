import { expect } from 'chai';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { redis } from '../src/infra/redis/index.ts';
import type { RedisQueue } from '../src/infra/redis-queue/index.ts';
import { createRedisQueue } from '../src/infra/redis-queue/index.ts';

export default () => {
	describe('Redis queue', () => {
		let key: string;
		let queue: RedisQueue;
		beforeEach(() => {
			key = `test:queue:{${randomUUID()}}`;
			queue = createRedisQueue(redis, key);
		});
		afterEach(async () => {
			await redis.del([key, `${key}:Q`]);
		});

		it('should return nothing when the queue is empty', async () => {
			expect(await queue.receiveMessage(30)).to.be.undefined;
		});

		it('should generate RSMQ compatible ids', async () => {
			const id = await queue.sendMessage('test');
			expect(id).to.match(/^[a-zA-Z0-9]{32}$/);
		});

		it('should receive a sent message and hide it for the visibility timeout', async () => {
			const id = await queue.sendMessage('test');
			expect(await queue.receiveMessage(1)).to.deep.equal({
				id,
				message: 'test',
			});
			expect(await queue.receiveMessage(1)).to.be.undefined;
			await setTimeout(1100);
			expect(await queue.receiveMessage(1)).to.deep.equal({
				id,
				message: 'test',
			});
		});

		it('should not receive a message before its delay', async () => {
			const id = await queue.sendMessage('test', 1);
			expect(await queue.receiveMessage(30)).to.be.undefined;
			await setTimeout(1100);
			expect(await queue.receiveMessage(30)).to.deep.equal({
				id,
				message: 'test',
			});
		});

		it('should delete a message', async () => {
			const id = await queue.sendMessage('test');
			expect(await queue.deleteMessage(id)).to.equal(true);
			expect(await queue.deleteMessage(id)).to.equal(false);
			expect(await queue.receiveMessage(30)).to.be.undefined;
			expect(await redis.exists(key)).to.equal(0);
		});

		it('should report the queue attributes', async () => {
			expect(await queue.getQueueAttributes()).to.deep.equal({
				totalsent: 0,
				totalrecv: 0,
				msgs: 0,
				hiddenmsgs: 0,
			});
			await queue.sendMessage('visible');
			await queue.sendMessage('delayed', 30);
			expect(await queue.getQueueAttributes()).to.deep.equal({
				totalsent: 2,
				totalrecv: 0,
				msgs: 2,
				hiddenmsgs: 1,
			});
			const msg = await queue.receiveMessage(30);
			expect(msg).to.have.property('message', 'visible');
			expect(await queue.getQueueAttributes()).to.deep.equal({
				totalsent: 2,
				totalrecv: 1,
				msgs: 2,
				hiddenmsgs: 2,
			});
			await queue.deleteMessage(msg!.id);
			expect(await queue.getQueueAttributes()).to.deep.equal({
				totalsent: 2,
				totalrecv: 1,
				msgs: 1,
				hiddenmsgs: 1,
			});
		});

		it('should process messages that were queued by RSMQ', async () => {
			// Mimic the data that RSMQ writes for a sent and then received message
			const id = '0123456789abcdefghijABCDEFGHIJ01';
			await redis.zAdd(key, { score: Date.now() - 1000, value: id });
			await redis.hSet(`${key}:Q`, {
				[id]: 'rsmq',
				[`${id}:rc`]: '1',
				[`${id}:fr`]: `${Date.now()}`,
			});
			expect(await queue.receiveMessage(30)).to.deep.equal({
				id,
				message: 'rsmq',
			});
			expect(await queue.deleteMessage(id)).to.equal(true);
			expect(await redis.hKeys(`${key}:Q`)).to.deep.equal(['totalrecv']);
		});
	});
};

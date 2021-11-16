/*
	Job Scheduler Library

	Using this lib:
		- require this file to get `JobFunction` and `scheduleJob()`.
		- create an instance of a `JobFunction` which will be the task you want to complete.
		  - this should manage its lock time accordingly to prevent multiple instances happening.
		  - default lock time is 5 seconds.
		- call `scheduleJob()` with an ID, a schedule in cron format, and the JobFunction to enable it.

	Under the hood:
		- node-schedule handles the job management and invocation in each API instance.
		- redlock is used to ensure only a single instance runs the job, like so:
			- When a job is triggered to start,
			- it acquires a lock via RedLock and runs,
			- if no lock can be acquired then the instance does not run the job,
			- upon completion the lock is released.
*/

import * as _ from 'lodash';
import * as schedule from 'node-schedule';
import * as Redis from 'ioredis';
import * as Redlock from 'redlock';
import { MINUTES, REDIS_HOST, REDIS_PORT } from '../../lib/config';
import { captureException } from '../error-handling';

export { Job } from 'node-schedule';

export type JobFunction = (
	fireDate: Date,
	lock: Redlock.Lock,
) => PromiseLike<void>;

interface JobInfo {
	nextInvocation: number;
}
interface LockSettings {
	ttl?: number;
}

const JOB_LOCK_PREFIX = 'api:jobs:execute:';
const JOB_INFO_PREFIX = 'api:jobs:info:';
const JOB_DEFAULT_TTL = 5000;

/*
 Retry to connect to the redis server every 200 ms. To allow recovering
 in case the redis server goes offline and comes online again.
*/
const redisRetryStrategy: NonNullable<
	ConstructorParameters<typeof Redis>[0]
>['retryStrategy'] = _.constant(200);

const client = new Redis({
	host: REDIS_HOST,
	port: REDIS_PORT,
	retryStrategy: redisRetryStrategy,
	enableOfflineQueue: false,
});

// If not handled will crash the process
client.on(
	'error',
	_.throttle((err: Error) => {
		captureException(err, 'Redis error');
	}, 5 * MINUTES),
);

const locker = new Redlock([client], {
	retryCount: 2,
	retryDelay: 50,
	retryJitter: 50,
});

const checkJobShouldExecute = async (
	jobInfoKey: string,
	job: schedule.Job,
	fireDate: Date,
): Promise<boolean> => {
	const value = await client.get(jobInfoKey);

	if (value == null) {
		updateJobInfoExecute(jobInfoKey, job);
		return true;
	}
	const jobInfo: JobInfo = JSON.parse(value);
	return (
		jobInfo.nextInvocation == null ||
		jobInfo.nextInvocation <= fireDate.getTime() ||
		jobInfo.nextInvocation > job.nextInvocation().getTime()
	);
};

const updateJobInfoExecute = async (jobInfoKey: string, job: schedule.Job) => {
	const jobInfo: JobInfo = {
		nextInvocation: job.nextInvocation().getTime(),
	};
	const serializedJobInfo = JSON.stringify(jobInfo);
	await client.set(jobInfoKey, serializedJobInfo);
};

export const scheduleJob = (
	jobId: string,
	rule:
		| schedule.RecurrenceRule
		| schedule.RecurrenceSpecDateRange
		| schedule.RecurrenceSpecObjLit
		| Date
		| string,
	jobFunction: JobFunction,
	lockOptions?: LockSettings,
): schedule.Job => {
	const ttl =
		lockOptions && lockOptions.ttl ? lockOptions.ttl : JOB_DEFAULT_TTL;
	const jobLockKey = JOB_LOCK_PREFIX + jobId;
	const jobInfoKey = JOB_INFO_PREFIX + jobId;
	const job: schedule.Job = schedule.scheduleJob(
		jobId,
		rule,
		async (fireDate: Date) => {
			try {
				const lock: Redlock.Lock = await locker.lock(jobLockKey, ttl);

				try {
					const shouldRun = await checkJobShouldExecute(
						jobInfoKey,
						job,
						fireDate,
					);

					if (shouldRun) {
						console.log(`[Scheduler] Running job: ${jobId}`);
						await jobFunction(fireDate, lock);

						console.log(
							`[Scheduler] Finished job: ${jobId}, next run at ${job.nextInvocation()}`,
						);
						await updateJobInfoExecute(jobInfoKey, job);
					}
				} catch (err) {
					captureException(err, `[Scheduler] Scheduled job failed: ${jobId}`);
					await updateJobInfoExecute(jobInfoKey, job);
				} finally {
					try {
						lock.unlock();
					} catch (err) {
						console.error(`[Scheduler] Failed to unlock job: ${jobId}`, err);
						captureException(err);
					}
				}
			} catch (err) {
				if (err instanceof Redlock.LockError) {
					if (
						/Exceeded\s\d+\sattempts\sto\slock\sthe\sresource\s/.test(
							err.message,
						)
					) {
						// this is not really an error
						console.error(
							`[Scheduler] Lock already in place for job: ${jobId}.`,
						);
						return;
					}
				}
				console.error(
					`[Scheduler] Failed to get a lock for job: ${jobId}, failed to get lock!`,
					err,
				);
				captureException(err);
			}
		},
	);

	return job;
};

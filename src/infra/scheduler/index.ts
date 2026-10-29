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
		- a redis lock is used to ensure only a single instance runs the job, like so:
			- When a job is triggered to start,
			- it acquires a lock via the lock lib and runs,
			- if no lock can be acquired then the instance does not run the job,
			- upon completion the lock is released.
*/

import { sbvrUtils, permissions } from '@balena/pinejs';
import schedule from 'node-schedule';
import type { ScheduledJobRun } from '../../balena-model.ts';
import { captureException } from '../error-handling/index.ts';
import {
	createLocker,
	LockReleaseError,
	LockUnavailableError,
} from '../lock/index.ts';
import { redis, redisRO } from '../redis/index.ts';
import { DISABLED_SCHEDULED_JOBS } from '../../lib/config.ts';

export type { Job } from 'node-schedule';

const { api } = sbvrUtils;

export type JobFunction = (
	fireDate: Date,
	scheduledJobRun: ScheduledJobRun['Read'],
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

const locker = createLocker(redis, {
	retryCount: 2,
	retryDelay: 50,
	retryJitter: 50,
});

const checkJobShouldExecute = async (
	jobInfoKey: string,
	job: schedule.Job,
	fireDate: Date,
): Promise<boolean> => {
	const value = await redisRO.get(jobInfoKey);

	if (value == null) {
		await updateJobInfoExecute(jobInfoKey, job);
		return true;
	}
	const jobInfo: JobInfo = JSON.parse(value);
	return (
		jobInfo.nextInvocation == null ||
		jobInfo.nextInvocation <= fireDate.getTime() ||
		jobInfo.nextInvocation > job.nextInvocation()!.getTime()
	);
};

const updateJobInfoExecute = async (jobInfoKey: string, job: schedule.Job) => {
	const jobInfo: JobInfo = {
		nextInvocation: job.nextInvocation()!.getTime(),
	};
	const serializedJobInfo = JSON.stringify(jobInfo);
	await redis.set(jobInfoKey, serializedJobInfo);
};

export const jobIds: string[] = [];
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
	jobIds.push(jobId);
	const ttl = lockOptions?.ttl ?? JOB_DEFAULT_TTL;
	const jobLockKey = JOB_LOCK_PREFIX + jobId;
	const jobInfoKey = JOB_INFO_PREFIX + jobId;
	const job: schedule.Job = schedule.scheduleJob(
		jobId,
		rule,
		async (fireDate: Date) => {
			try {
				if (DISABLED_SCHEDULED_JOBS.has(jobId)) {
					// If jobs are not enabled then we immediately return without taking a lock.
					// This allows dynamically enabling/disabling jobs without needing to restart the API.
					return;
				}
				// eslint-disable-next-line @typescript-eslint/no-unused-vars -- released when it goes out of scope
				await using _lock = await locker.lock(jobLockKey, ttl);
				const rootApi = api.resin.clone({
					passthrough: { req: permissions.root },
				});
				let scheduledJobRun: ScheduledJobRun['Read'] | undefined;

				try {
					const shouldRun = await checkJobShouldExecute(
						jobInfoKey,
						job,
						fireDate,
					);

					if (shouldRun) {
						console.log(`[Scheduler] Running job: ${jobId}`);
						scheduledJobRun = await rootApi.post({
							resource: 'scheduled_job_run',
							body: {
								name: jobId,
								start_timestamp: Date.now(),
								status: 'running',
							},
						});

						await jobFunction(fireDate, scheduledJobRun);

						console.log(
							`[Scheduler] Finished job: ${jobId}, next run at ${job.nextInvocation()}`,
						);
						await rootApi.patch({
							resource: 'scheduled_job_run',
							id: scheduledJobRun.id,
							body: {
								status: 'success',
								end_timestamp: Date.now(),
							},
						});
						await updateJobInfoExecute(jobInfoKey, job);
					}
				} catch (err) {
					captureException(err, `[Scheduler] Scheduled job failed: ${jobId}`);
					if (scheduledJobRun != null) {
						await rootApi.patch({
							resource: 'scheduled_job_run',
							id: scheduledJobRun.id,
							options: {
								$filter: {
									// If the job managed to run up to the point that was marked as
									// successful, then don't mark it as failed since the actual
									// jobFunction invocation did complete.
									status: { $ne: 'success' },
								},
							},
							body: {
								status: 'error',
								end_timestamp: Date.now(),
							},
						});
					}
					await updateJobInfoExecute(jobInfoKey, job);
				}
			} catch (err) {
				if (err instanceof LockUnavailableError) {
					// this is not really an error
					console.error(`[Scheduler] Lock already in place for job: ${jobId}.`);
					return;
				}
				if (err instanceof LockReleaseError) {
					console.error(`[Scheduler] Failed to unlock job: ${jobId}`, err);
					captureException(err);
					return;
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

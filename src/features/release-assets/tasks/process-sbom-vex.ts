import { tasks, sbvrUtils, permissions } from '@balena/pinejs';
import type { FromSchema } from 'json-schema-to-ts';

const schema = {
	type: 'object',
	properties: {
		releaseAssetId: { type: 'integer' },
	},
	required: ['releaseAssetId'],
	additionalProperties: false,
} as const;

export type SubmitSBOMTaskParams = FromSchema<typeof schema>;

const { api } = sbvrUtils;

tasks.addTaskHandler(
	'submit_sbom_to_dependency_track',
	async (options) => {
		const dtUrl = process.env.DEPENDENCY_TRACK_URL;
		const dtApiKey = process.env.DEPENDENCY_TRACK_API_KEY;
		if (dtUrl == null || dtApiKey == null) {
			return {
				status: 'cancelled',
				error: 'DependencyTrack not configured',
			};
		}

		try {
			const { releaseAssetId } = options.params;

			const releaseAsset = await api.resin.get({
				resource: 'release_asset',
				passthrough: { req: permissions.rootRead },
				id: releaseAssetId,
				options: {
					$select: ['id', 'asset'],
					$expand: {
						release: {
							$select: ['id', 'commit'],
							$expand: {
								belongs_to__application: {
									$select: ['id', 'slug'],
								},
							},
						},
					},
				},
			});

			if (releaseAsset == null) {
				return { status: 'cancelled', error: 'Release asset not found' };
			}
			if (releaseAsset.asset == null) {
				return { status: 'cancelled', error: 'Release asset has no content' };
			}

			const release = releaseAsset.release[0];
			const application = release.belongs_to__application[0];
			const projectName = application.slug;
			const projectVersion = release.commit;

			const downloadAbort = new AbortController();
			const downloadTimeout = setTimeout(() => {
				downloadAbort.abort();
			}, 30_000);
			const downloadRes = await fetch(releaseAsset.asset.href, {
				signal: downloadAbort.signal,
			}).finally(() => {
				clearTimeout(downloadTimeout);
			});
			if (!downloadRes.ok) {
				return {
					status: 'failed',
					error: `Asset download failed: ${downloadRes.status}`,
				};
			}
			const content = Buffer.from(await downloadRes.arrayBuffer());

			const isVex = releaseAsset.asset.filename.endsWith('vex.json');

			if (isVex) {
				const dtAbort = new AbortController();
				const dtTimeout = setTimeout(() => {
					dtAbort.abort();
				}, 10_000);
				const lookupRes = await fetch(
					`https://${dtUrl}/api/v1/project/lookup?name=${encodeURIComponent(projectName)}&version=${encodeURIComponent(projectVersion)}`,
					{ headers: { 'X-Api-Key': dtApiKey }, signal: dtAbort.signal },
				).finally(() => {
					clearTimeout(dtTimeout);
				});
				if (lookupRes.status === 404) {
					// SBOM may not have been processed yet — let the task retry
					return {
						status: 'failed',
						error: `DT project not found for ${projectName}@${projectVersion} — SBOM may not be processed yet`,
					};
				}
				if (!lookupRes.ok) {
					return {
						status: 'failed',
						error: `DT project lookup failed: ${lookupRes.status}`,
					};
				}
				const project = (await lookupRes.json()) as { uuid: string };
				const vexAbort = new AbortController();
				const vexTimeout = setTimeout(() => {
					vexAbort.abort();
				}, 10_000);
				const dtRes = await fetch(`https://${dtUrl}/api/v1/vex`, {
					method: 'PUT',
					headers: {
						'Content-Type': 'application/json',
						'X-Api-Key': dtApiKey,
					},
					body: JSON.stringify({
						project: project.uuid,
						projectName,
						projectVersion,
						vex: content.toString('base64'),
					}),
					signal: vexAbort.signal,
				}).finally(() => {
					clearTimeout(vexTimeout);
				});
				if (!dtRes.ok) {
					console.error(
						'Failed sending to Dependency Track',
						dtRes.status,
						'vex',
					);
					return { status: 'failed', error: `DT returned ${dtRes.status}` };
				}
			} else {
				const form = new FormData();
				form.append('projectName', projectName);
				form.append('projectVersion', projectVersion);
				form.append('autoCreate', 'true');
				form.append(
					'bom',
					new Blob([content], { type: 'application/json' }),
					'bom.json',
				);
				const bomAbort = new AbortController();
				const bomTimeout = setTimeout(() => {
					bomAbort.abort();
				}, 10_000);
				const dtRes = await fetch(`https://${dtUrl}/api/v1/bom`, {
					method: 'POST',
					headers: { 'X-Api-Key': dtApiKey },
					body: form,
					signal: bomAbort.signal,
				}).finally(() => {
					clearTimeout(bomTimeout);
				});
				if (!dtRes.ok) {
					console.error(
						'Failed sending to Dependency Track',
						dtRes.status,
						'bom',
					);
					return { status: 'failed', error: `DT returned ${dtRes.status}` };
				}
			}

			return { status: 'succeeded' };
		} catch (e) {
			console.error('[submit_sbom_to_dependency_track]', e);
			return { error: `${e}`, status: 'failed' };
		}
	},
	schema,
);

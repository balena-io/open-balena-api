### PR 1. Implement open-balena-api SBVR for build time:

SBVR addition

```yaml
Term: profile name
	Concept Type: Short Text (Type)

Fact type: release image has profile name
    Term Form: image profile
    Database Table Name: image profile
    Necessity: each image profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
```

Then the migration

```sql
CREATE TABLE IF NOT EXISTS "image profile" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"release image" INTEGER NOT NULL
,	"profile name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("release image") REFERENCES "image-is part of-release" ("id")
,	UNIQUE("release image", "profile name")
,	-- It is necessary that each image profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
CONSTRAINT "image profile$JNq7JtNpsLLnjhmNEfxBOCEqui7N5rB4gZp5QGt4bvs=" CHECK (0 < LENGTH("profile name")
AND LENGTH("profile name") <= 100
AND LENGTH("profile name") IS NOT NULL
AND "profile name" IS NOT NULL)
);
```

Note: This is the proposal SBVR. There are still open question to where the FK goes (just `image` and double FK to `image` and `release` being the other ones).

Run the models generation with 
```
npm run generate-model-types
```

Authorization:
- `named-user-api-key` (and by extension `default-user`): `resin.image_profile.all` — same blanket grant as the other release-scoped resources (`image_label`, `image_environment_variable`).
- `device-api-key`: `resin.image_profile.read?release_image/canAccess()` — read-only, scoped through the image it already has read access to. Devices never create their own `image_profile` rows; only a push does.

Then write the new test suite for profiles with a build creation:

Small, build-time-only suite for this PR (`test/NN_profiles.ts`, mirroring the existing tag-style resource tests): POST an `image_profile` against a fixture release image and assert it's created; assert the length/necessity constraint rejects an empty/overlong `profile_name`; assert a device key gets 401 trying to create one directly. No activation/state assertions yet — those land with PR 6/7 once the run-time tables and state gating exist.

Cascade delete: add `image_profile: 'release_image'` to the existing `image__is_part_of__release` cascade group in `src/features/cascade-delete/hooks.ts` (same group `image_label`/`image_environment_variable` already sit in) — deleting a release image removes its profile tags.

Validation: `profile_name` must match Docker's compose profile name format, `^[a-zA-Z0-9][a-zA-Z0-9_.-]+$`. API-level, not a DB `CHECK` — same shape as `src/features/tags/validation.ts`'s `checkTagKeyValidity`/`registerTagHooks` (`POSTPARSE` hook reading `request.values`, `BadRequestError` on mismatch). New `src/features/profiles/validation.ts`:

```ts
import { errors, hooks } from '@balena/pinejs';

const PROFILE_NAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/;

export const checkProfileNameValidity = (name: string) => {
	if (!PROFILE_NAME_REGEX.test(name)) {
		throw new errors.BadRequestError(
			`Profile name must match ${PROFILE_NAME_REGEX}.`,
		);
	}
};

export const registerProfileNameHooks = (resource: string, fieldName: string) => {
	const hook: hooks.Hooks = {
		POSTPARSE: ({ request }) => {
			if (request.values[fieldName] != null) {
				checkProfileNameValidity(request.values[fieldName]);
			}
		},
	};
	hooks.addPureHook('POST', 'resin', resource, hook);
	hooks.addPureHook('PATCH', 'resin', resource, hook);
};
```

Wired in this PR: `registerProfileNameHooks('image_profile', 'profile_name')`. `application_profile`/`device_profile` reuse the same helper in PR 5 — `application_profile.activates__profile_name` and `device_profile.profile_name` (see PR 5 for why the field names differ between the two).

### PR 2. Bump the build time `image profile` on balena-api

Follow the exact `image_label` pattern found in `src/features/auth/roles/named-user-api-key.ts:322-328`:

```ts
'resin.image_profile.read?release_image/canAccess()',
...writePerms(
    'resin.image_profile',
    `release_image/any(ipr:ipr/is_part_of__release/any(r:r/${belongsToApplicationGranularPermission('can_create_release')}))`,
    ['create', 'update'],
),
`resin.image_profile.delete?release_image/any(ipr:ipr/is_part_of__release/any(r:r/${belongsToApplicationGranularPermission('can_delete_release')}))`,
```

Reads follow `canAccess()` on the release image; writes are gated by the existing `can_create_release`/`can_delete_release` granular permissions (i.e. anyone who can push a release can tag it with profiles) — no new permission needed, since tagging happens as part of the push itself.

Allowlist, from `src/features/allowlist/definitions.ts:540-544`:

```ts
image_profile: {
    read: ['id', 'created_at', 'release_image', 'profile_name'],
    create: ['release_image', 'profile_name'],
    update: [],
},
```

No `delete` entry needed in the allowlist (delete doesn't take a field list); no `update` fields since rows are immutable once created.

### DEPLOY AND TEST HERE ###

We should be able to manually do the POST that balena-compose does.

### PR 3. balena-compose usage

Needs specific config to use `resin` endpoint

https://github.com/balena-io-modules/balena-compose/blob/master/lib/release/api.ts#L232 

??

should we publish an actual release or just keep draft and publish a draft of the cli?

### PR 4. Update balena-compose with v above on the CLI

### PR 5. open-balena-api SBVR run time

```yaml
Fact type: application activates profile name on application1
    Term Form: application profile
    Database Table Name: application profile
    Necessity: each application profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
```

`application profile` stays this simple shape — no override concept exists above the fleet, so `profile name` stays mandatory.

`device profile` needs `profile name` to be genuinely nullable (a `NULL` row = "override with no profiles"). **Verified against the real SBVR compiler**: this is impossible if `profile name` stays a component of the fact that *defines* the `device profile` term form — `Necessity: each device profile has at most one profile name.` (the idiom that makes `device.note` nullable) crashes the compiler (`TypeError` in `CardinalityOptimisation2`) whenever the field being loosened is part of the term-form-defining fact itself, for both a ternary and a stripped-down binary version of this fact. The fix, also verified: make `device profile` a bare Term (like `device`/`application` — own serial id, no defining fact) and attach its fields via separate Fact Types, the same pattern already used for `release asset` in this codebase (Term Form from `asset key`, then a separate `release asset has asset` fact attaches the nullable WebResource):

```yaml
Term: device profile

Fact type: device profile has device
    Synonymous Form: device owns device profile
    Necessity: each device profile has exactly one device.

Fact type: device profile has application
    Necessity: each device profile has exactly one application.

Fact type: device profile has profile name
    Necessity: each device profile has at most one profile name.
    Necessity: each device profile that has a profile name, has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
```

This compiles cleanly and auto-generates `"profile name" VARCHAR(255) NULL` — genuinely nullable, no hand-diverging migration, and `npm run generate-model-types` correctly emits `profile_name: string | null` with no manual type patch.

Splitting the Term Form out of the defining fact also drops the automatic per-fact-type `UNIQUE` — it has to be reasserted as explicit Rules (also verified against the compiler, including the exact generated validation SQL):

```yaml
Rule: It is necessary that each device that owns a device profile1 that has an application and has a profile name, owns at most one device profile2 that has an application that is of the device profile1 and has a profile name that is of the device profile1.

Rule: It is necessary that each device that owns a device profile1 that has an application and has no profile name, owns at most one device profile2 that has an application that is of the device profile1 and has no profile name.
```

The first rule replaces the old `UNIQUE(device, activates-profile name, on-application)` for real activations. The second is the actual fix for the override-dedup problem — "at most one no-profile-name row per `(device, application)`" — enforced the same way every other SBVR necessity is (a validation query scoped to the affected row, run inside the request transaction), no `NULLS NOT DISTINCT`/Postgres-15 dependency, no migration divergence.

The field names this phrasing produces are plain `application`/`profile_name`, not `on__application`/`activates__profile_name` — `"on-application"` isn't valid as a bare noun phrase inside a Rule, so that exact column name wasn't reachable here. Rather than chase naming parity with a synonym, `device_profile` just keeps these plain names: `application_profile` and `device_profile` have different field names for "the same" concept from here on (`on__application`/`activates__profile_name` vs. `application`/`profile_name`), which every reference below (hooks, resolver, cascade-delete, allowlist) uses as written — no renaming, no synonym layer.

And its associated migration
```sql
CREATE TABLE IF NOT EXISTS "application profile" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"application" INTEGER NOT NULL
,	"activates-profile name" VARCHAR(255) NOT NULL
,	"on-application" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
,	FOREIGN KEY ("on-application") REFERENCES "application" ("id")
,	UNIQUE("application", "activates-profile name", "on-application")
,	-- It is necessary that each application profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
CONSTRAINT "application profile$RLsm+plcgv5chOijFdfezmde8H800RSDdEcmcYYlUzM" CHECK (0 < LENGTH("activates-profile name")
AND LENGTH("activates-profile name") <= 100
AND LENGTH("activates-profile name") IS NOT NULL
AND "activates-profile name" IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS "device profile" (
	"created at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"modified at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	"device" INTEGER NOT NULL
,	"application" INTEGER NOT NULL
,	"profile name" VARCHAR(255)          -- nullable: NULL row = "override with no profiles"
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
);
-- Verified against the real compiler: unlike `image_profile`/`application_profile`, this table
-- gets no inline CHECK — a *conditional* necessity ("that has a profile name, has...") compiles
-- to a Rule validation query instead (same mechanism as the two Rules above: scoped to the
-- affected row, run inside the request transaction), not a table CHECK/UNIQUE constraint:
--
-- 1. Length: 0 < LENGTH("profile name") <= 100, only checked when "profile name" IS NOT NULL.
-- 2. No two rows with the same (device, application) both having the same non-NULL profile name.
-- 3. No two rows with the same (device, application) both having a NULL profile name.
```

This is the exact table this repo's `src/migrations/00113-add-profiles.sql` now creates — verified by compiling the real `src/balena.sbvr` end-to-end and diffing the output.

No separate `device_profile_override` table — the override is just a `NULL`-profile-name row in this same `device_profile` table.

Cascade delete, in `src/features/cascade-delete/hooks.ts`:

```ts
setupDeleteCascade('application', {
	...
	application_profile: ['application', 'on__application'], // both roles reference application
	device_profile: 'application',
	...
});

setupDeleteCascade('device', {
	...
	device_profile: 'device',
	...
});
```

Deleting an app clears both its own activations and any activation (including `NULL`-override rows) that targeted it; deleting a device clears its own activations/overrides. No separate cascade group needed for the override case — it's the same `device_profile` resource.

Validation:

- Profile name format: reuse PR 1's `registerProfileNameHooks` on each table's profile-name field (`application_profile.activates__profile_name`, `device_profile.profile_name` — different names, see above). The `!= null` guard already in `registerProfileNameHooks` (from PR 1) means a `NULL` `device_profile.profile_name` skips the regex check for free — no extra parameter needed:
  ```ts
  registerProfileNameHooks('application_profile', 'activates__profile_name');
  registerProfileNameHooks('device_profile', 'profile_name');
  ```
- Activation-time sanity check: `application_profile.application` (the activator) must be a fleet, not a block or app-type application. `POSTPARSE` hook, `application.is_of__class` lookup:
  ```ts
  hooks.addPureHook('POST', 'resin', 'application_profile', {
  	async POSTPARSE({ request, api }) {
  		if (request.values.application == null) {
  			return;
  		}
  		const application = await api.get({
  			resource: 'application',
  			id: request.values.application,
  			options: { $select: 'is_of__class' },
  		});
  		if (application?.is_of__class !== 'fleet') {
  			throw new errors.BadRequestError(
  				'Profiles can only be activated on fleets.',
  			);
  		}
  	},
  });
  ```
- Activation-target sanity check: the target being profiled (`application_profile.on__application` / `device_profile.application` — different field names, same role) must currently be a **hostapp**, i.e. `is_host === true`. This is deliberately loose for now: it only checks the target application is host-type at all, not that it's the specific hostapp the activator (fleet/device) actually runs — that would mean walking `should_be_operated_by__release.belongs_to__application` (see `src/balena.sbvr`'s "each release that should operate a device... belongs to an application that is host", and `src/features/hostapp/hooks/target-hostapp.ts`'s `belongs_to__application: { is_host: true }` filter for the existing precedent). Left as a TODO since profiles are hostapp-only in this rollout; extending to "must match the fleet's/device's actual running hostapp" is tracked together with the userapps/supervisor-apps TODOs below.

  ```ts
  const checkTargetIsHostapp = async (
  	api: PinejsClient,
  	applicationId: number,
  ) => {
  	const targetApplication = await api.get({
  		resource: 'application',
  		id: applicationId,
  		options: { $select: 'is_host' },
  	});
  	if (targetApplication?.is_host !== true) {
  		// TODO(userapps)/TODO(supervisor apps): once profiles extend beyond
  		// hostapps, we need to remove this validation
  		throw new errors.BadRequestError(
  			'Profiles can currently only be activated on a hostapp.',
  		);
  	}
  };

  ```

- Profile-name existence check: the activated profile name (`application_profile.activates__profile_name` / `device_profile.profile_name`) must actually exist as an `image_profile` on *some* release belonging to the target application — you can't activate a profile no release of that app ever declared (typo, stale name, wrong app). Does **not** apply to `device_profile`'s `profile_name: null` (the override row isn't "activating" any declared name, there's nothing to check it against):

  ```ts
  const checkProfileNameExistsOnApplication = async (
  	api: PinejsClient,
  	applicationId: number,
  	profileName: string,
  ) => {
  	const [imageProfile] = await api.get({
  		resource: 'image_profile',
  		options: {
  			$top: 1,
  			$select: 'id',
  			$filter: {
  				profile_name: profileName,
  				release_image: {
  					$any: {
  						$alias: 'ipr',
  						$expr: {
  							ipr: {
  								is_part_of__release: {
  									$any: {
  										$alias: 'r',
  										$expr: { r: { belongs_to__application: applicationId } },
  									},
  								},
  							},
  						},
  					},
  				},
  			},
  		},
  	});
  	if (imageProfile == null) {
  		throw new errors.BadRequestError(
  			`Profile "${profileName}" does not exist on any release of application ${applicationId}.`,
  		);
  	}
  };
  ```

  Both `POSTPARSE` hooks, consolidated (`checkTargetIsHostapp` always runs when there's a target; `checkProfileNameExistsOnApplication` only runs for a real, non-`NULL` name — the `device_profile` override row skips it). Note the two hooks read different field names off `request.values` — `application_profile.on__application`/`activates__profile_name` vs. `device_profile.application`/`profile_name`:

  ```ts
  hooks.addPureHook('POST', 'resin', 'application_profile', {
  	async POSTPARSE({ request, api }) {
  		if (request.values.on__application == null) {
  			return;
  		}
  		await checkTargetIsHostapp(api, request.values.on__application);
  		await checkProfileNameExistsOnApplication(
  			api,
  			request.values.on__application,
  			request.values.activates__profile_name,
  		);
  	},
  });

  hooks.addPureHook('POST', 'resin', 'device_profile', {
  	async POSTPARSE({ request, api }) {
  		if (request.values.application == null) {
  			return;
  		}
  		await checkTargetIsHostapp(api, request.values.application);
  		if (request.values.profile_name != null) {
  			await checkProfileNameExistsOnApplication(
  				api,
  				request.values.application,
  				request.values.profile_name,
  			);
  		}
  	},
  });
  ```

Profile deactivation on last-release deletion: the inverse problem — a profile can be activated, then the release(s) that declared it get deleted (directly, or transitively: `release` → `image__is_part_of__release` → `image_profile`, via PR 1's cascade group, which itself runs through `api.delete` and therefore still fires resource hooks — see `src/infra/cascade-delete/index.ts`). If that was the last `image_profile` row providing that name for that application, any `application_profile`/`device_profile` still activating it is now pointing at a name that exists nowhere — deactivate it rather than leave it dangling. A `DELETE` hook on `image_profile` itself, following the snapshot-in-`PRERUN`/act-in-`POSTRUN` shape used by the existing `user`/`api_key` delete hooks in `src/features/cascade-delete/hooks.ts` (stash on `request.custom`, since the rows are gone by `POSTRUN`):

```ts
hooks.addPureHook('DELETE', 'resin', 'image_profile', {
	PRERUN: async (args) => {
		const affectedIds = await sbvrUtils.getAffectedIds(args);
		if (affectedIds.length === 0) {
			return;
		}
		const deleted = await args.api.get({
			resource: 'image_profile',
			options: {
				$select: 'profile_name',
				$filter: { id: { $in: affectedIds } },
				$expand: {
					release_image: {
						$select: 'id',
						$expand: {
							is_part_of__release: { $select: 'belongs_to__application' },
						},
					},
				},
			},
		});
		args.request.custom.deletedProfilePairs = dedupeByNameAndApp(
			deleted.map((row) => ({
				profileName: row.profile_name,
				applicationId:
					row.release_image[0].is_part_of__release[0].belongs_to__application
						.__id,
			})),
		);
	},
	POSTRUN: async (args) => {
		const pairs = args.request.custom.deletedProfilePairs as
			| Array<{ profileName: string; applicationId: number }>
			| undefined;
		if (!pairs?.length) {
			return;
		}
		await Promise.all(
			pairs.map(async ({ profileName, applicationId }) => {
				const [stillExists] = await args.api.get({
					resource: 'image_profile',
					options: {
						$top: 1,
						$select: 'id',
						$filter: {
							profile_name: profileName,
							release_image: {
								$any: {
									$alias: 'ipr',
									$expr: {
										ipr: {
											is_part_of__release: {
												$any: {
													$alias: 'r',
													$expr: {
														r: { belongs_to__application: applicationId },
													},
												},
											},
										},
									},
								},
							},
						},
					},
				});
				if (stillExists != null) {
					return; // still declared on another release, leave activations alone
				}
				// Different field names per resource (see PR 5) -- can't share one filter shape.
				await Promise.all([
					args.api.delete({
						resource: 'application_profile',
						passthrough: { tx: args.tx, req: permissions.root },
						options: {
							$filter: {
								activates__profile_name: profileName,
								on__application: applicationId,
							},
						},
					}),
					args.api.delete({
						resource: 'device_profile',
						passthrough: { tx: args.tx, req: permissions.root },
						options: {
							$filter: {
								profile_name: profileName,
								application: applicationId,
							},
						},
					}),
				]);
			}),
		);
	},
});
```

Note the read in `POSTRUN` runs after the triggering `image_profile` row(s) are already gone, so "still exists" doesn't need to exclude the affected ids — it's a plain existence check against current state. This lives in PR 5 (not PR 1) since it deletes from `application_profile`/`device_profile`, which don't exist until this PR.

Tests: none beyond SBVR/migration sanity for this PR (`npm run generate-model-schema` compiles cleanly, migration applies) — these tables have no API-reachable behavior yet since PR 6 hasn't added the roles/allowlist to write them. Behavioral tests (including all validations above and the last-release deactivation hook) land in PR 6.

### PR 6. Bump the run time tables on balena-api

Update the model: same `npm run generate-model-types` step as PR 1/2.

Authorization: standard check — reuse `can_modify_hostapp_extensions`, the granular permission that gates `application_hostapp_extension`/`device_hostapp_extension`. These new tables are what those generalize into, so same check, no new `can_*` field.

Developer-only, by `src/features/organizations/lib/application-membership-roles.ts`:
- L51: `Observer` sets `can_modify_hostapp_extensions: false`.
- L54/L79/L90: `SafeOperator`/`SafeDeveloper`/`Operator` all spread `...Observer`/`...SafeOperator` and never override it — stays `false`.
- L103-115: `Developer` spreads `...Operator`, then overrides at L115: `can_modify_hostapp_extensions: true`.

`applicationGranularPermission('can_modify_hostapp_extensions')` (used in the permission strings below) resolves to an OData filter on the actor's `application_membership_role` row for that fleet — true only for `developer`. In `src/features/auth/roles/named-user-api-key.ts`, alongside the block at lines 138-141/185-188:

```ts
`resin.application_profile.read?application/canAccess()`,
...writePerms(
    'resin.application_profile',
    applicationGranularPermission('can_modify_hostapp_extensions'),
),

'resin.device_profile.read?device/canAccess()',
...writePerms(
    'resin.device_profile',
    `device/any(d:d/${belongsToApplicationGranularPermission('can_modify_hostapp_extensions')})`,
),
```

`writePerms` defaults to `['create', 'update', 'delete']` — same as the existing `application_hostapp_extension`/`device_hostapp_extension` blocks. `update` matters more for `device_profile` than it did for the old boolean-existence design: toggling a *real* activation on/off is still create/delete, but an override row's `NULL` doesn't need to change to anything else in practice, so `update` mainly covers correcting a mistaken POST rather than a normal-path operation. Read is `canAccess()`-gated same as every other fleet/device sub-resource; a device's own API key gets read-only (matches `test/27_profiles.ts`'s "should not allow a device to create its own device profiles" — no `device-api-key.ts` entry needed beyond the existing `device/canAccess()`-style reads it already has for `device_hostapp_extension`).

Allowlist, following the exact `application_hostapp_extension`/`device_hostapp_extension` shape in `src/features/allowlist/definitions.ts`:

```ts
application_profile: {
    read: ['id', 'created_at', 'application', 'activates__profile_name', 'on__application'],
    create: ['application', 'activates__profile_name', 'on__application'],
    update: [],
},
device_profile: {
    read: ['id', 'created_at', 'device', 'profile_name', 'application'],
    create: ['device', 'profile_name', 'application'],
    update: [],
},
```

Tests, extending the PR 1 suite: POST `application_profile`/`device_profile` as a `developer`-role user and assert 201; same POSTs as `observer`/`operator` and assert 401/403; a device key POSTing its own `device_profile` gets 401 (mirrors PR 1's build-time check); DELETE removes the row (toggling off). Cascade: deleting the app/device and asserting the rows are gone. Validation (PR 5): `application_profile.activates__profile_name`/`device_profile.profile_name` reject a value failing the Docker regex (e.g. leading `-`, whitespace) — but `NULL` is accepted for `device_profile.profile_name` (the override case); POSTing `application_profile` against a block/app-type `application` (not a fleet) gets rejected; POSTing either resource with its target-application field (`application_profile.on__application` / `device_profile.application`) pointing at a non-hostapp (`is_host: false`) application gets rejected; pointing at *some* hostapp that isn't actually the fleet's/device's running hostapp is **not** rejected yet (no check exists for that stricter case in this PR — asserting that absence is itself a useful regression guard until the TODO lands); activating a profile name no release of the target application ever declared via `image_profile` gets rejected (does not apply to `device_profile.profile_name: null`). `device_profile` override dedup (PR 5's second Rule): POST a `device_profile` with `profile_name: null` for `(device, application)`, then POST another identical one, assert the second is rejected (409/400, the SBVR Rule firing); POST two *different* real profile names for the same `(device, application)`, assert both succeed (the first Rule only dedupes identical names, not distinct ones). Deactivation-on-deletion: activate a profile, delete the one release image declaring it, assert the `application_profile`/`device_profile` row is gone; activate the same profile again where *two* releases declare it, delete one, assert the activation survives (still declared by the other release), then delete the second and assert it's now gone too; same via the `release` cascade path (delete the release itself, not just the image), to exercise the hook firing transitively through cascade delete rather than only on a direct `image_profile` DELETE. A `device_profile` override row (`profile_name: null`) is untouched by this hook — it isn't tied to any `image_profile`.

### DEPLOY AND TEST HERE ###

It should now be possible to toggle on and off profiles, it just won't make anything on the target state and on the device



### PR 7: open-balena-api DEVICE STATE V3 update to compute and filter the profiles ONLY for hostapps now

Note: state endpoint is (probably - hopefully) using DB prepared queries, need to double check if we need special treatment for that on deploy (I strongly believe not)

`src/features/device-state/routes/state-get-v3.ts` — expands needed, all inside the single prepared `deviceExpand`/`releaseExpand` (no per-request `$filter`, state stays one prepared statement):

- On `device` directly (once, not per-target — these aren't hostapp-specific), via the `owns__device_profile` nav property (see PR 5 for why `device_profile`'s field names/nav-property differ from `application_profile`'s). A single expand now covers both real activations and overrides — a `NULL` `profile_name` is the override row:
  ```ts
  owns__device_profile: {
      $select: ['profile_name', 'application'],
  },
  ```
- A reusable `application_profile` fragment, expanded onto whichever `belongs_to__application` is being rendered:
  ```ts
  const appProfileExpand = {
      application_profile: {
          $select: ['activates__profile_name', 'on__application'],
      },
  } as const;
  ```
- On `release_image` (for the gating check itself, both this app's releases and any updater block):
  ```ts
  image_profile: {
      $select: 'profile_name',
  },
  ```

Where `appProfileExpand` gets mixed in, **this PR only**:
- `should_be_operated_by__release.belongs_to__application` (the hostapp) — the actual scope of this PR.

TODO(userapps): mix `appProfileExpand` into the device's own `belongs_to__application` expand (the userapp the device runs) — deferred, not part of this PR.

TODO(supervisor apps): mix `appProfileExpand` into `should_be_managed_by__release.belongs_to__application` (the supervisor app) — deferred, not part of this PR.

Resolve the active set per rendered application (device activation/override wins over the fleet's, scoped per target application). Presence of *any* `device_profile` row for that application — including a `NULL`-named one — signals an override; the `NULL` is then filtered out of the resulting set itself, since it isn't a real profile name (if that was the only row, the result is correctly the empty set). This is copied verbatim from the real, implemented `resolveActiveProfiles` in `src/features/device-state/routes/state-get-v3.ts`:

```ts
const noActiveProfiles: ReadonlySet<string> = new Set();

type ApplicationProfileActivation = {
	activates__profile_name: string;
	on__application: { __id: number };
};

export const resolveActiveProfiles = (
	device: Pick<ExpandedDevice, 'owns__device_profile'> | undefined,
	application:
		| { id: number; application_profile: ApplicationProfileActivation[] }
		| undefined,
): ReadonlySet<string> => {
	if (application == null) {
		return noActiveProfiles;
	}
	const deviceProfiles = device?.owns__device_profile.filter(
		(activation) => activation.application.__id === application.id,
	);
	if (device != null && (deviceProfiles?.length ?? 0) > 0) {
		return new Set(
			deviceProfiles!
				.map(({ profile_name }) => profile_name)
				.filter((profileName) => profileName != null),
		);
	}
	return new Set(
		application.application_profile.map(
			({ activates__profile_name }) => activates__profile_name,
		),
	);
};
```

Note the deliberate asymmetry: `application.application_profile` items use `activates__profile_name`/`on__application` (unchanged `application_profile` shape from PR 5), while `device.owns__device_profile` items use `profile_name`/`application` (the restructured `device_profile` shape) — the function reads each with its own real field names rather than normalizing them to a shared shape.

Then, per release image, while building the service list:

```ts
if (
	ipr.image_profile.length > 0 &&
	!ipr.image_profile.some(({ profile_name }) =>
		activeProfiles.has(profile_name),
	)
) {
	continue;
}
```

The resolver itself is generic — it takes whatever `application`/`device` rows it's handed, no hostapp-specific logic inside it. What's scoped to hostapp-only in this PR is purely the call site: wire it into `should_be_operated_by__release` only.

TODO(userapps): wire `resolveActiveProfiles` into the `should_be_running__release` render path once its expand (above) lands.

TODO(supervisor apps): wire `resolveActiveProfiles` into the `should_be_managed_by__release` render path once its expand (above) lands.

Fleet state endpoint (`/device/v3/fleet/:uuid/state`) is unaffected by the hostapp-only scoping here — it calls `resolveActiveProfiles(undefined, fleet)` for whichever fleet's own release is being rendered (no device to override), so it's already generic; include it in this PR's tests.

Tests: extend the profiles suite with state-shape assertions on the hostapp path only — a profiled service hidden by default, shown once the fleet activates it, device activation taking priority over the fleet's, the override toggle falling back once cleared, a device overriding one target application while another (untouched by this PR) has nothing to fall back from, and the fleet-state endpoint. TODO(userapps)/TODO(supervisor apps): equivalent assertions once their expand + call site land.

### PR 8: bump state on balena-api


### DEPLOY AND TEST HERE ###

If this works then the api should be ready to support profiles on the /resin endpoint. If it does not (e.g. breaks the state endpoint because of performance) - we will need to tweak the cluster/db to support the new query


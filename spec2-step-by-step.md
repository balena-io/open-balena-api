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

Wired in this PR: `registerProfileNameHooks('image_profile', 'profile_name')`. `application_profile`/`device_profile` reuse the same helper in PR 5, since the field is the same shape (`activates__profile_name`) there too.

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

Fact type: device activates profile name on application
    Term Form: device profile
    Database Table Name: device profile
    Necessity: each device profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
```

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
,	"device" INTEGER NOT NULL
,	"activates-profile name" VARCHAR(255) NOT NULL
,	"on-application" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("on-application") REFERENCES "application" ("id")
,	UNIQUE("device", "activates-profile name", "on-application")
,	-- It is necessary that each device profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
CONSTRAINT "device profile$uIGbagOmDbbG9dHHnnp7eT5eWRMBPdJc4X+POtluXzw=" CHECK (0 < LENGTH("activates-profile name")
AND LENGTH("activates-profile name") <= 100
AND LENGTH("activates-profile name") IS NOT NULL
AND "activates-profile name" IS NOT NULL)
);
```

**Resolved**: ship `device_profile_override` (see spec2.md's "overrides with empty profile" section) in this same PR — it's a single additive table with no dependency on PR 6, and bundling it avoids a window where devices can only partially express an override.

Cascade delete, in `src/features/cascade-delete/hooks.ts`:

```ts
setupDeleteCascade('application', {
	...
	application_profile: ['application', 'on__application'], // both roles reference application
	device_profile: 'on__application',
	device_profile_override: 'overrides_profiles_on__application',
	...
});

setupDeleteCascade('device', {
	...
	device_profile: 'device',
	device_profile_override: 'device',
	...
});
```

Deleting an app clears both its own activations and any activation/override that targeted it; deleting a device clears its own activations/overrides.

Validation:

- Profile name format: reuse PR 1's `registerProfileNameHooks` on both tables' `activates__profile_name`:
  ```ts
  registerProfileNameHooks('application_profile', 'activates__profile_name');
  registerProfileNameHooks('device_profile', 'activates__profile_name');
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
- Activation-target sanity check: `on__application` (the target being profiled — present on both `application_profile` and `device_profile`) must currently be a **hostapp**, i.e. `is_host === true`. This is deliberately loose for now: it only checks the target application is host-type at all, not that it's the specific hostapp the activator (fleet/device) actually runs — that would mean walking `should_be_operated_by__release.belongs_to__application` (see `src/balena.sbvr`'s "each release that should operate a device... belongs to an application that is host", and `src/features/hostapp/hooks/target-hostapp.ts`'s `belongs_to__application: { is_host: true }` filter for the existing precedent). Left as a TODO since profiles are hostapp-only in this rollout; extending to "must match the fleet's/device's actual running hostapp" is tracked together with the userapps/supervisor-apps TODOs below.

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

  hooks.addPureHook('POST', 'resin', 'application_profile', {
  	async POSTPARSE({ request, api }) {
  		if (request.values.on__application != null) {
  			await checkTargetIsHostapp(api, request.values.on__application);
  		}
  	},
  });

  hooks.addPureHook('POST', 'resin', 'device_profile', {
  	async POSTPARSE({ request, api }) {
  		if (request.values.on__application != null) {
  			await checkTargetIsHostapp(api, request.values.on__application);
  		}
  	},
  });
  ```

Tests: none beyond SBVR/migration sanity for this PR (`npm run generate-model-schema` compiles cleanly, migration applies) — these tables have no API-reachable behavior yet since PR 6 hasn't added the roles/allowlist to write them. Behavioral tests (including all three validations above) land in PR 6.

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

'resin.device_profile_override.read?device/canAccess()',
...writePerms(
    'resin.device_profile_override',
    `device/any(d:d/${belongsToApplicationGranularPermission('can_modify_hostapp_extensions')})`,
),
```

`writePerms` defaults to `['create', 'update', 'delete']` — same as the existing `application_hostapp_extension`/`device_hostapp_extension` blocks, even though `update` is a no-op in practice (all three are existence-based; toggling is create/delete). Read is `canAccess()`-gated same as every other fleet/device sub-resource; a device's own API key gets read-only on all three (matches `test/27_profiles.ts`'s "should not allow a device to create its own device profiles" — no `device-api-key.ts` entry needed beyond the existing `device/canAccess()`-style reads it already has for `device_hostapp_extension`).

Allowlist, following the exact `application_hostapp_extension`/`device_hostapp_extension` shape in `src/features/allowlist/definitions.ts`:

```ts
application_profile: {
    read: ['id', 'created_at', 'application', 'activates__profile_name', 'on__application'],
    create: ['application', 'activates__profile_name', 'on__application'],
    update: [],
},
device_profile: {
    read: ['id', 'created_at', 'device', 'activates__profile_name', 'on__application'],
    create: ['device', 'activates__profile_name', 'on__application'],
    update: [],
},
device_profile_override: {
    read: ['id', 'created_at', 'device', 'overrides_profiles_on__application'],
    create: ['device', 'overrides_profiles_on__application'],
    update: [],
},
```

Tests, extending the PR 1 suite: POST `application_profile`/`device_profile`/`device_profile_override` as a `developer`-role user and assert 201; same POSTs as `observer`/`operator` and assert 401/403; a device key POSTing its own `device_profile` gets 401 (mirrors PR 1's build-time check); DELETE removes the row (toggling off). Cascade: deleting the app/device and asserting the rows are gone. Validation (PR 5): `activates__profile_name` rejects a value failing the Docker regex (e.g. leading `-`, whitespace); POSTing `application_profile` against a block/app-type `application` (not a fleet) gets rejected; POSTing either `application_profile` or `device_profile` with `on__application` pointing at a non-hostapp (`is_host: false`) application gets rejected; POSTing with `on__application` pointing at *some* hostapp that isn't actually the fleet's/device's running hostapp is **not** rejected yet (no check exists for that stricter case in this PR — asserting that absence is itself a useful regression guard until the TODO lands).

### DEPLOY AND TEST HERE ###

It should now be possible to toggle on and off profiles, it just won't make anything on the target state and on the device



### PR 7: open-balena-api DEVICE STATE V3 update to compute and filter the profiles ONLY for hostapps now

Note: state endpoint is (probably - hopefully) using DB prepared queries, need to double check if we need special treatment for that on deploy (I strongly believe not)

`src/features/device-state/routes/state-get-v3.ts` — expands needed, all inside the single prepared `deviceExpand`/`releaseExpand` (no per-request `$filter`, state stays one prepared statement):

- On `device` directly (once, not per-target — these aren't hostapp-specific):
  ```ts
  device_profile: {
      $select: ['activates__profile_name', 'on__application'],
  },
  device_profile_override: {
      $select: ['overrides_profiles_on__application'],
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

Resolve the active set per rendered application (device activation/override wins over the fleet's, scoped per `on__application`):

```ts
const noActiveProfiles: ReadonlySet<string> = new Set();

export const resolveActiveProfiles = (
	device:
		| Pick<ExpandedDevice, 'device_profile' | 'device_profile_override'>
		| undefined,
	application:
		| { id: number; application_profile: ProfileActivation[] }
		| undefined,
): ReadonlySet<string> => {
	if (application == null) {
		return noActiveProfiles;
	}
	const deviceProfiles = device?.device_profile.filter(
		(activation) => activation.on__application.__id === application.id,
	);
	const deviceOverridesThisApplication = device?.device_profile_override.some(
		(override) =>
			override.overrides_profiles_on__application.__id === application.id,
	);
	const profiles =
		device != null &&
		((deviceProfiles?.length ?? 0) > 0 || deviceOverridesThisApplication)
			? (deviceProfiles ?? [])
			: application.application_profile;
	return new Set(
		profiles.map(({ activates__profile_name }) => activates__profile_name),
	);
};
```

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


# Model Proposal for OS Profiles #2: unified modeling of hostapp vs other app

> [//]: # (callout;icon-type=icon;icon=exclamation-circle;color=#199EE3)
> Based on outcome of[[view: Call Notes: Extensions & Profile Modeling#^a0b03b18-8310-4435-992e-da09b5f17bcd/f0817b52-e719-4f8d-8443-f19e415ca139]] and discussion surrounding[[view: Model Proposal for OS Profiles #1: separate modeling of hostapp vs other app#^a0b03b18-8310-4435-992e-da09b5f17bcd/5a89d400-7976-11f1-b153-c50886fa5597]], this proposal addresses the limitations of the API concept of "host app extensions" and instead generalizes them simply as "profiles". Build time stays the same with proposal #1 - we propose changes on runtime activation model.

# Data modeling proposal

This proposal's modeling is similar to existing patterns on tags. The main idea resolves around associating `release image`s to `profile name`s during build time and having an explicit set of profile activations at run time. **Unlike an earlier version of this proposal, there is no separate `hostapp extension` concept: activation directly reuses `profile name`, and a second `application` role records which app's releases the activation applies to. This makes hostapp extensions the specific case where that target app happens to be the hostapp, rather than a distinct entity — the same tables can serve future userapp/supervisor profile activation.**

## **SBVR Proposal**

**Build time (unchanged):**

```yaml
Term: profile name
	Concept Type: Short Text (Type)

Fact type: release image has profile name
    Term Form: image profile
    Database Table Name: image profile
    Necessity: each image profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
```

* `profile name` should have a validation hook to ensure it matches Docker regex `[a-zA-Z0-9][a-zA-Z0-9_.-]+`

**Run-time activation:**

```yaml
Fact type: application activates profile name on application1
    Term Form: application profile
    Database Table Name: application profile
    Necessity: each application profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
```

`application profile` stays exactly this shape — a plain Term Form generated directly from the ternary fact, `profile name` mandatory. There's no override concept above the fleet in this proposal, so it doesn't need what follows.

`device profile` does need to express "no profile" as a distinct state, and that requires a different shape than `application profile`. You cannot make a field nullable if it's one of the components of the fact type that *defines* the Term Form itself — `Necessity: each device profile has at most one profile name.` (the standard idiom that makes e.g. `device.note` nullable) crashes the compiler outright when the "profile name" being modified is part of `device profile`'s own defining fact (`TypeError` inside `CardinalityOptimisation2`, reproduced for both this ternary fact and a stripped down binary one). So `device profile` is restructured as a bare Term with its fields attached via separate Fact Types — the same pattern this codebase already uses for `release asset` (Term Form from `asset key`, then a separate `release asset has asset` fact attaches the nullable WebResource):

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

With `profile name` no longer part of the term-defining fact, the compiler auto-generates it as genuinely nullable — `"profile name" VARCHAR(255) NULL` — and `npm run generate-model-types` correctly emits `profile_name: string | null`. No manual type override needed anywhere.

The field names that fall out of this phrasing are plain `application` and `profile_name` — not `on__application`/`activates__profile_name` like `application_profile` uses (`"on-application"` isn't valid as a bare noun phrase inside a Rule, so that exact column name wasn't reachable here). Rather than fight this with a synonym, `device_profile` just keeps these plain names — `application_profile` and `device_profile` have different field names for "the same" concept, which is a real asymmetry, but a synonym purely for naming parity wasn't worth it: every reference to `device_profile.application`/`profile_name` elsewhere in this doc and in spec2-step-by-step.md means the resource's real field.

Splitting the Term Form out of the defining fact also means the natural per-fact-type `UNIQUE` no longer exists — it has to be re-asserted explicitly as SBVR Rules (also verified against the compiler):

```yaml
Rule: It is necessary that each device that owns a device profile1 that has an application and has a profile name, owns at most one device profile2 that has an application that is of the device profile1 and has a profile name that is of the device profile1.

Rule: It is necessary that each device that owns a device profile1 that has an application and has no profile name, owns at most one device profile2 that has an application that is of the device profile1 and has no profile name.
```

The first rule is the everyday case: no two rows can activate the *same* profile name for the same `(device, application)` — equivalent to the old `UNIQUE(device, activates-profile name, on-application)`. The second is the actual fix for "overrides with empty profile": no two rows can both have *no* profile name for the same `(device, application)` — this is what `UNIQUE NULLS NOT DISTINCT` would have given us, except expressed natively in SBVR (no Postgres-15-specific syntax, no hand-written migration diverging from the generated schema).

A simplified (removing the length check constraint, and created/modified_at for readability) version of the SQL from the above is:

```sql
-- BUILD TIME
CREATE TABLE IF NOT EXISTS "image profile" (
	"release image" INTEGER NOT NULL
,	"profile name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("release image") REFERENCES "image-is part of-release" ("id")
,	UNIQUE("release image", "profile name")
);

-- ACTIVATION TIME
CREATE TABLE IF NOT EXISTS "application profile" (
	"application" INTEGER NOT NULL              -- the activator (e.g. a fleet admin's own app)
,	"activates-profile name" VARCHAR(255) NOT NULL
,	"on-application" INTEGER NOT NULL           -- which app's releases this activation applies to
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
,	FOREIGN KEY ("on-application") REFERENCES "application" ("id")
,	UNIQUE("application", "activates-profile name", "on-application")
);

CREATE TABLE IF NOT EXISTS "device profile" (
	"device" INTEGER NOT NULL
,	"application" INTEGER NOT NULL              -- which app's releases this activation applies to
,	"profile name" VARCHAR(255)                 -- nullable: NULL row = "override with no profiles"
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
);
-- Uniqueness enforced by the two Rules above (checked per-request, same mechanism as every
-- other SBVR necessity), not by a table constraint.
```

### **The "overrides with empty profile" problem**

The modeling above does not present a current way to say "given this application(fleet) which has active profiles by default, override this specific device, on this specific app, **with no profiles**". This is a runtime activation only problem, resolved as follows: `device profile.profile name` is nullable, and a row with `NULL` for a given `(device, application)` pair means "this device overrides the fleet's default for this app, with nothing active". The presence of *any* `device profile` row (real name or `NULL`) for that pair signals an override; its absence means "fall through to the fleet's `application profile`s".

This was previously considered and shelved in favor of a separate boolean-existence table (`device profile override`), over two objections — both addressed by the restructuring above:

1. **SQL doesn't dedupe `NULL`s**, so naively adding a nullable column risks multiple redundant `NULL` rows for the same `(device, application)` pair. Solved by the second Rule above, which explicitly asserts "at most one no-profile-name row per `(device, application)`" — enforced the same way every other SBVR necessity is (a validation query scoped to the affected row on every write), no schema-level trick needed.
2. **It breaks the `profile name` Length necessity** (`NULL` trivially fails "length > 0"). Solved by scoping the necessity to only apply when the field is populated: *"each device profile that has a profile name, has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100"*.

No separate table, fact type, or resource — `device profile` is one table with an optional `profile name`, and two Rules doing the deduping SBVR-natively instead of via a Postgres-specific constraint.

## **Data Flow**

#### During build time:

`balena-compose` (and by consequence any of our clients: the builder, git and both cli build/deploy) will do:

```
For each profileName of a given image/service (after compose-parser):
    POST /resin/image_profile {
        release_image: releaseImage.id, // just created release image
        profile_name: profileName
    }
```

#### Deciding the run time:

A member of the fleet which will install the hostapps (proposal: someone with minimum `developer` access to the fleet, or maybe stricter for app level) configures the profiles on their fleet/device (this API call is the MVP goal). Since `on__application` targets the hostapp app own id, activating a hostapp extension for a fleet looks like:

fleet:

```
POST /resin/application_profile {
    application: 1234,        // the userapp fleet whose admin is doing the activation
    activates__profile_name: "kernel-modules",
    on__application: 5678     // the hostapp (for userapps profiles, the userapp and so on)
}
```

device (note the field names differ from `application_profile` above — `profile_name`/`application`, not `activates__profile_name`/`on__application`; see the SBVR Proposal section for why):

```
POST /resin/device_profile {
    device: 1234,
    profile_name: "kernel-modules",
    application: 5678
}
```

To override a fleet's default with **no profiles active** for a given app, POST with `profile_name: null`:

```
POST /resin/device_profile {
    device: 1234,
    profile_name: null,
    application: 5678
}
```

**NEEDS INPUT:** Do we need a way to validate that we only activate "on__application" if the device is running that application? How does that validation works at fleet level? If we activate on profile for the fleet and then have no more devices (hup etc) running the release with that profile, what would we expect to happen then? If we do any kind of validation here, it should probably happen on an api runtime level for creation (as a guardrail) rather than DB level constraints to avoid e.g. blocking deleting a device because it has a given profile.

#### Modifying the runtime

After having both runtime built and the decision on which profiles should run on a fleet/device, each `device state` response will be modified to contain the active services for the hostapp. From there on, it goes into supervisor land which is worked on a separated project.

#### Problem: What if we want to activate multiple profiles at the same time without causing double reboot?

Currently, to activate two profiles at the same time, we would need two POST requests. Even if they are fired concurrently, they are not the same transaction so there is a small window where the state get endpoint could still show them independently.

Although there is a small chance of it happening, at a large fleet scale, it is sure plausible, but this can be addressed: OData supports $batch operations (running all of them under the same transaction), which requires its own building. Alternatively, this can be more easily be achieved with a custom endpoint too (although $batch is a more complete solution that improves the overall platform).

## State endpoint

For each app, we would need to compute the set of active profiles and then when iterating over the release `release_image` we would need to decide which applications to send over the target state.

We can get the active set for each running app by expanding from `belongs_to__application` into `application_profile` for each of the running apps. The specific cases of OS profiles is simply an $expand into `application_profile` from the `belongs_to__application` on the fleet (app) `should_be_operated_by__release`

Calculating the hostapp active set:

```javascript
export const resolveActiveProfiles = (
    device: ...,
	application: ...,
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

Note `device_profile` and `application_profile` use different field names for "the same" concept — `device_profile.application`/`profile_name` vs. `application_profile.on__application`/`activates__profile_name` — since the field names `device_profile` actually gets are a side effect of the bare-Term restructuring (see the SBVR Proposal section); a synonym purely for naming parity wasn't worth adding. `owns__device_profile` is the nav-property name for "device profile owned by this device" (from the `Synonymous Form: device owns device profile` declaration), separate from the `application`/`profile_name` field names on the row itself.

Presence of *any* `device_profile` row for the `(device, application)` pair — including a `NULL`-named one — signals an override, so the fleet's `application_profile`s are skipped. The `NULL` rows are then filtered out of the active set itself, since `NULL` isn't a real profile name: if that was the only row, the result is the empty set, which is exactly "override with no profiles".

Now, on this point on the v3 state endpoint: <https://github.com/balena-io/open-balena-api/blob/master/src/features/device-state/routes/state-get-v3.ts#L157>

We can use the above set (for each of the apps), now properly into the `profiles` part of the feature to skip or include its `release_image` with

```javascript
if (
    ipr.image_profile.length > 0 &&
    !ipr.image_profile.some(({ profile_name }) =>
        activeProfiles.has(profile_name),
    )
) {
    continue;
}
```

This also matches [docker-compose semantics](https://docs.docker.com/compose/how-tos/profiles/) which says: "services with no profile are always active" and "services with any amount of profiles are only active if at least one of their profiles is active".

## Cascade Deletion

TODO

## Authorization

For open-balena-api, authorizations should be straightforward as it is a single-user view.

For balena-api this is **open discussion and needs product input,** the main question is, what permission does a user need to set the hostapp extensions of a fleet? and of a device? and for standard profiles (non hostapps) is it different?

**Proposal for simplicity sake of the MVP**: `developers` can toggle profiles on and off in both application and device level - an UX notice is that we probably want the UI to warn you about stuff so you don't just missclick it and accidentaly get all your devices downloading MB and rebooting (treat toggling profiles as a destructive action for both enabling and disabling). 

*Note on api authorization:* We probably want to follow the pattern for custom roles, I am thinking mostly around a "can_modify_hostapp_extension" but maybe we should start simpler than that (although I am not sure that following the standard custom role pattern isn't easier)

## Field allowlist definitions

TODO

## Validations and constraints

TODO: How do we validate (on the api) that what you are enabling makes some sense?

## Extra metadata

This is future speculation but just so its drafted and clear that this is considered for this building: we can attach metadata (which can come from anywhere, including `balena.yaml`). **The current DB model makes no assumption on how we will want to manage this metadata** — whether it should live **per release profile** (scoped to a specific release's `image profile` row) or **per app profile** (a single source of truth shared across every release of an app that declares a same-named profile). Nothing in the proposed schema forecloses either path; both are purely additive from here, so this can stay undecided until there's a concrete product need. The two ideas aren't mutually exclusive either — behavioral fields (e.g. `requires reboot`) could stay per release profile while presentational fields (e.g. logo, description) live per app profile, with both existing side by side.

### Option A — per release profile (scoped to `image profile`)

These live alongside the `release image` table as new fields on `image profile` itself — e.g. a `requires reboot` boolean field. Each release re-declares its own metadata at build time, so an old release keeps showing exactly what it declared even if a later release changes the reboot-requirement for a same-named profile.

* **Pro**: correctness by construction. A device pinned to an old release can never show metadata that release didn't actually ship with — "does enabling this profile reboot my device" always has one unambiguous answer, the one the running release declared.
* **Con**: if a profile spans multiple services/images within the same release, this metadata gets duplicated across every `image profile` row for that release (same value repeated N times, expected to agree, nothing enforcing it).

### Option B — per app profile (single source of truth, future evolution)

A separate table, keyed by `UNIQUE (application, profile_name)`, holding metadata shared across every release that declares that profile name — needs its own name since `application_profile` is already taken by the run-time activation table. The idea is that this would be populated the first time a given `(application, profile_name)` pair is seen at build time, and could then be edited independently of pushes (e.g. by a curator), making it an actual single source of truth rather than whatever the latest push happened to say.

* **Pro**: exactly one logo/description per profile name per app — what a "browse profiles available to this app" marketplace-style UI wants, without having to pick a release to read from.
* **Con**: only safe for *purely presentational* metadata. Anything that changes runtime behavior (reboot, size, license agreements, etc.) can't live here without breaking Option A's correctness guarantee — if release X requires a reboot and release Y doesn't, "does the app profile require a reboot" has no single correct answer, so behavioral metadata has to stay release-scoped regardless of whether Option B ships.

## TODOS:

**Do we need profile groups?** If so, it can be done on top of the above modeling, if not necessary we can bypass.

**Concurrency issues with multiple posts?** E.g. If we want to activate multiple profiles we would need several POST /application_profile or /device_profile in a single transaction. The chances of a state endpoint get in the middle of concurrent POSTs is low but not zero - We can probably solve with a custom api route or with proper implementation of $batch - IMO, this is not a blocker for the MVP.

## Questions/Answers:

**1) Why isn't runtime activation simply a config var `BALENA_COMPOSE_PROFILES` so that fleet and device overrides happen for free with already existing mechanisms? This would mimic docker compose behavior.**

Couple of reasons, in order of most to least important:

* Because we need the profile to be active per combination of `profile` and `app`. Fleet/device config vars are scoped to all running apps and this would create a possible clash among profiles of different origins.
* Permission model gets fragile: we can model profiles permissions and scale them regardless of any special casing for config vars

**2) Why don't we have a "application profiles" table with logos and stuff?**

The current model can be extended with "application profiles catalog" table if need so - it is not in this proposal because the modeling here is supposed to be the minimal extensible thing we need for an MVP, see [Metadata B](https://balena.fibery.io/Work/Project/Supporting-docker-compose-profiles-on-balenaCloud-2480/Model-Proposal-for-OS-Profiles-2-5357/anchor=Option-B-per-app-profile-\(single-source--0df7b490-4978-4322-a52b-171531612f3b "https://balena.fibery.io/Work/Project/Supporting-docker-compose-profiles-on-balenaCloud-2480/Model-Proposal-for-OS-Profiles-2-5357/anchor=Option-B-per-app-profile-(single-source--0df7b490-4978-4322-a52b-171531612f3b") for how we could achieve that in the future

**Please comment additional questions here and they will be added**

* \[from [[otaviojacobi#@1b728600-af9c-11e9-95b5-2985503542d7/d3d17851-a28b-4550-95de-452dbdb2f141]] \] I think there is a corner case where if a fleet enables a given hostapp extension (say, `debug` ) and then add a device with a different DT (e.g. a raspberrypi fleet which has raspberrypi4 adds a raspberrypi5 device) the device will not pick it up because it is a different hostapp.

       Answer: This is the expected behavior. From product side, we should be able to select `per hostapp` which extensions are enabled or not. E.g. if you have a fleet mixing rpi4 and rpi5 you might just want some different set of profiles enabled on each.
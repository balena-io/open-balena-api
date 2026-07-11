# Model Proposal for OS Profiles #2

> [//]: # (callout;icon-type=icon;icon=exclamation-circle;color=#199EE3)
> Based on the outcome from [[view: Call Notes: Extensions & Profile Modeling#^a0b03b18-8310-4435-992e-da09b5f17bcd/f0817b52-e719-4f8d-8443-f19e415ca139]] and the trade-offs from the approach presented in [[view: Model Proposal for Hostapp extensions #1#^a0b03b18-8310-4435-992e-da09b5f17bcd/5a89d400-7976-11f1-b153-c50886fa5597]] this proposal searches to address the limitations of the API understanding "host app extensions" and instead, generalize them simply as "profiles". Build time stays the same - we propose changes on runtime activation model.

# Data modeling proposal

This proposal's modeling is similar to existing patterns on tags. The main idea resolves around associating `release image`s to `profile name`s during build time and having an explicit set of profile activations at run time. **Unlike an earlier version of this proposal, there is no separate `hostapp extension` concept: activation directly reuses `profile name`, and a second `application` role records which app's releases the activation applies to. This makes hostapp extensions the specific case where that target fleet happens to be the hostapp, rather than a distinct entity — the same tables can serve future userapp/supervisor profile activation.**

## **SBVR Proposal**

Build time (unchanged):

```
Term: profile name
	Concept Type: Short Text (Type)

Fact type: release image has profile name
    Term Form: image profile
    Database Table Name: image profile
    Necessity: each image profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
```

Run-time activation:

```
Fact type: application activates profile name on application1
    Term Form: application profile
    Database Table Name: application profile
    Necessity: each application profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.

Fact type: device activates profile name on application
    Term Form: device profile
    Database Table Name: device profile
    Necessity: each device profile has a profile name that has a Length (Type) that is greater than 0 and is less than or equal to 100.
```

Each row means "the activator (`application`/`device`) turns on profile `X` for the releases owned by `on-application`".

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
,	"activates-profile name" VARCHAR(255) NOT NULL
,	"on-application" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("on-application") REFERENCES "application" ("id")
,	UNIQUE("device", "activates-profile name", "on-application")
);
```

**Note**: the joined table for "image profile" is where we could, incrementally, attatch each release metadata. If we need a file (an actual uploaded asset) we can say "image profile has logo image (which is already a WebResource - all pipes are there) or "image profile \[requires reboot\]" or "image profile \[requires signing accepting terms\]" and so on.

### **The "overrides with empty profile" problem**

The modeling above does not present a current way to say "given this application(fleet) -which has active profiles by default- override this specific device, on this specific app, **with no profiles**".  Current modeling above causes this where we can't directly differentiate a device not overriding any profile to one overriding with empty profiles. This is a runtime activation only problem and for that we propose the following:

```
Fact type: device overrides profiles on application
	Term Form: device profile override
	Database Table Name: device profile override
```

And its equivalent migration (created at etc hidden for readability):

```sql
CREATE TABLE IF NOT EXISTS "device profile override" (
,	"device" INTEGER NOT NULL
,	"on-application" INTEGER NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	FOREIGN KEY ("on-application") REFERENCES "application" ("id")
,	UNIQUE("device", "on-application")
);
```

**IMPORTANT/DISCUSSION:**  This is a "boolean" table - the existance of the record means true, the abscene means false. There is an alternative modeling to this problem by baking the overrides into the "device profile" table and use a specific value to mean "empty profiles", probably, this value could be `NULL`. This comes with its own sets of tradeoffs: 

1 - SQL does not dedupe `NULL`s so we could get multiple - redundant - overrides.

2 - It breaks the Length necessity, so we would need an exception for that

We could also go with stuff like empty string or special value, all to which I believe are inferior to the "boolean" table proposed above, but it is still open to discussion.

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

A member of the fleet which will install the hostapps (proposal: someone with minimum `developer` access to the fleet, or maybe stricter for app level) configures the profiles on their fleet/device (this API call is the MVP goal). Since `on__application` targets the hostapp fleet's own id, activating a hostapp extension for a userapp fleet looks like:

fleet:

```
POST /resin/application_profile {
    application: 1234,        // the userapp fleet whose admin is doing the activation
    activates__profile_name: "kernel-modules",
    on__application: 5678     // the hostapp (for userapps profiles, the userapp)
}
```

device:

```
POST /resin/device_profile {
    device: 1234,
    activates__profile_name: "kernel-modules",
    on__application: 5678
}
```

**TODO:** Do we need a way to validate that we only activate "on__application" if the device is running that application? How does that validation works at fleet level? If we activate on profile for the fleet and then have no more devices (hup etc) running the release with that profile, what would we expect to happen then? If we do any kind of validation here, it should probably happen on an api runtime level for creation (as a guardrail) rather than DB level constraints to avoid e.g. blocking deleting a device because it has a given profile.

#### Modifying the runtime

After having both runtime built and the decision on which profiles should run on a fleet/device, each `device state` response will be modified to contain the active services for the hostapp. From there on, it goes into supervisor land which is worked on a separated project.

#### Problem: What if we want to activate multiple profiles at the same time without causing double reboot?

Currently, to activate two profiles at the same time, we would need two POST requests. Even if they are fired concurrently, they are not the same transaction so there is a small window where the state get endpoint could still show them independently.

Altough there is a small chance of it happening, at a large fleet scale, it is sure plausible, but this can be addressed: OData supports $batch operations (running all of them under the same transaction), which requires its own building. Alternatevely, this can be more easily be achieved with a custom endpoint too (altough $batch is a more complete solution that improves the overall platform).

## State endpoint

For host app extensions, we would need to compute the set of active hostapp extensions and then when iterating over the release `release_image` we would need to device which applications to send over the target state.

We can get the active set for each running app by expanding from `belongs_to__application` into `application_profile` for each of the running apps. The specific cases of OS profiles is simply an $expand into `application_profile` from the `belongs_to__applicaiton` on the fleet (app) `should_be_operated_by__release`

Calculating the hostapp active set:

```javascript
export const resolveActiveHostappExtensions = (
    device: ...,
	application: ...,
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

TODO (depends on making a decision on how we decide "overrides with empty profile" modeling to go)

## Authorization

For open-balena-api, authorizations should be straightforward as it is a single-user view.

For balena-api this is **open discussion and needs product input,** the main question is, what permission does a user need to set the hostapp extensions of a fleet? and of a device? and for standard profiles (non hostapps) is it different?

**Proposal for simplicity sake of the MVP**: `developers` can toggle profiles on and off in both application and device level - an UX notice is that we probably want the UI to warn you about stuff so you don't just missclick it and accidentaly get all your devices downloading MB and rebooting (treat toggling profiles as a destructive action for both enabling and disabling). 

## Field allowlist definitions

TODO (depends on making a decision on how we decide "overrides with empty profile" modeling to go)

## Hostapp (and profiles) discovery

TODO: 

Application level discovery: ?

Fleet level discovery: you know the release each of the device's  app is running and can find the relevant metadata on the associated `release image` table (we can do more fancy things here if need so, but that should be sufficient). 

## Validations and constraints

TODO: How do we validate (on the api) that what you are enabling makes some sense?

## Extra metadata

This is future speculation but just so its draft and clear that this is considered for this building: we can attatch metadata (which can come from anywhere, including `balena.yaml`). **The current DB model makes no assumption on how we will want to manage this metadata** — whether it should live **per release profile** (scoped to a specific release's `image profile` row) or **per app profile** (a single source of truth shared across every release of an app that declares a same-named profile). Nothing in the shipped schema forecloses either path; both are purely additive from here, so this can stay undecided until there's a concrete product need. The two ideas aren't mutually exclusive either — behavioral fields (e.g. `requires reboot`) could stay per release profile while presentational fields (e.g. logo, description) live per app profile, with both existing side by side.

### Option A — per release profile (scoped to `image profile`)

These live alongside the `release image` table as new fields on `image profile` itself — e.g. a logo added as a WebResource `profile logo` field, a `requires reboot` boolean field, and so on. Each release re-declares its own metadata at build time, so an old release keeps showing exactly what it declared even if a later release changes the logo/description/reboot-requirement for a same-named profile.

- **Pro**: correctness by construction. A device pinned to an old release can never show metadata that release didn't actually ship with — "does enabling this profile reboot my device" always has one unambiguous answer, the one the running release declared.
- **Con**: if a profile spans multiple services/images within the same release, this metadata gets duplicated across every `image profile` row for that release (same value repeated N times, expected to agree, nothing enforcing it).

### Option B — per app profile (single source of truth, future evolution)

A separate table, keyed by `UNIQUE (application, profile_name)`, holding metadata shared across every release that declares that profile name — needs its own name since `application_profile` is already taken by the run-time activation table. The idea is that this would be populated the first time a given `(application, profile_name)` pair is seen at build time, and could then be edited independently of pushes (e.g. by a curator), making it an actual single source of truth rather than whatever the latest push happened to say.

- **Pro**: exactly one logo/description per profile name per app — what a "browse profiles available to this fleet" marketplace-style UI wants, without having to pick a release to read from.
- **Con**: only safe for *purely presentational* metadata. Anything that changes runtime behavior (reboot, size, license agreements, etc.) can't live here without breaking Option A's correctness guarantee — if release X requires a reboot and release Y doesn't, "does the app profile require a reboot" has no single correct answer, so behavioral metadata has to stay release-scoped regardless of whether Option B ships.
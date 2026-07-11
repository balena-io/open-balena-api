# Model Proposal for Hostapp extensions #1

# Data modeling proposal

This proposal's modeling is similar to existing patterns on tags. The main idea resolves around associating  `release image`s to `profile name`s during build time and having an explicit set of hostapp extensions activations at run time. **Important: for this proposal, although hostapp extensions use the same inner pipes than userapp profiles, they are modeled as separated entities to avoid issues of name clashing and because they are separated features.**

## SBVR Proposal

Build time:

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
Term: hostapp extension
	Concept Type: Short Text (Type)

Fact type: application activates hostapp extension
    Term Form: application hostapp extension
    Database Table Name: application hostapp extension
    Necessity: each application hostapp extension has a hostapp extension that has a Length (Type) that is greater than 0 and is less than or equal to 100.

Fact type: device activates hostapp extension
    Term Form: device hostapp extension
    Database Table Name: device hostapp extension
    Necessity: each device hostapp extension has a hostapp extension that has a Length (Type) that is greater than 0 and is less than or equal to 100.
```

As mentioned these uses the same form of tags for unique keys, except it does not have an equivalent "value", essentially being the modeling of a set of keys rather than a key-value map. A simplified (removing the length check constraint, and created/modified_at for readability) version of the SQL from the above is:

```sql
CREATE TABLE IF NOT EXISTS "image profile" (
,	"release image" INTEGER NOT NULL
,	"profile name" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("release image") REFERENCES "image-is part of-release" ("id")
,	UNIQUE("release image", "profile name")
);

CREATE TABLE IF NOT EXISTS "application hostapp extension" (
,	"application" INTEGER NOT NULL
,	"activates-hostapp extension" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("application") REFERENCES "application" ("id")
,	UNIQUE("application", "activates-hostapp extension")
);

CREATE TABLE IF NOT EXISTS "device hostapp extension" (
,	"device" INTEGER NOT NULL
,	"activates-hostapp extension" VARCHAR(255) NOT NULL
,	"id" SERIAL NOT NULL PRIMARY KEY
,	FOREIGN KEY ("device") REFERENCES "device" ("id")
,	UNIQUE("device", "activates-hostapp extension")
);
```

Note that the customer facing activation is related to `hostapp` and not `profiles`: This is by design as it allow us to in a follow up step say something like ("application activates profiles"), these mean runtime profiles and not hostapps: they both consume the release image profiles but each as its own functionality.

### The "overrides with empty profile" problem

The modeling above does not present a current way to say "given this application -which has active hostapps (profiles) by default- override this specific device with no hostapps (profiles)". Using the modeling above we can't directly differentiate a device not overriding any hostapp (profile) to one overriding with empty hostapps. This is a runtime activation only problem and for that we propose the following:

```
Fact type: device [overrides hostapp extensions]
```

And its equivalent migration:

```sql
ALTER TABLE "device"
ADD COLUMN IF NOT EXISTS "overrides hostapp extensions" BOOLEAN DEFAULT FALSE NOT NULL;
```

This does not enforce any specific behavior over the UI: it can manage this state with whatever UX it has to define how/when things are overridden or not.

## Data Flow

#### During build time:

`balena-compose` (and by consequence any of our clients: the builder, git and both cli build/deploy) will do:

```
For each profileName of a given image/service (after compose-parser):
    POST /resin/image_profile {
        release_image: releaseImage.id, // just created release image
        profile_name: profileName
    }
```

This is agnostic for both hostapp extensions and for any kind of profiles to be done in the future (userapps, other apps, supervisor etc).

#### Deciding the runtime:

A member of the fleet which will install the hostapps (proposal: someone with minimum `developer` access to the fleet, or maybe stricter for app level) configures the hostapp extensions on their fleet/device (this API call is the MVP goal):

fleet:

```
POST /resin/application_hostapp_extension {
    application: 1234,
    activates__hostapp_extension: "kernel-modules"
}
```

device:

```
POST /resin/device_hostapp_extension {
    device: 1234,
    activates__hostapp_extension: "kernel-modules"
}
```

#### Modifying the runtime

After having both runtime built and the decision on which profiles should run on a fleet/device, each `device state` response will be modified to contain the active services for the hostapp. From there on, it goes into supervisor land which is worked on a separated project.

#### Problem: What if we want to activate multiple extensions at the same time without causing double reboot?

Currently, to activate two extensions at the same time, we would need two POST requests. Even if they are fired concurrently, they are not the same transaction so there is a small window where the state get endpoint could still show them independently.

Altough there is a small chance of it happening, at a large fleet scale, it is sure plausible, but this can be addressed: OData supports $batch operations (running all of them under the same transaction), which requires its own building. Alternatevely, this can be more easily be achieved with a custom endpoint too (altough $batch is a more complete solution that improves the overall platform).

## Hostapps Extensions vs Profiles

Altough hostapp extensions `use` profiles internally this modeling assumes we will manage hostapps as one thing and profiles as its other - separated entity.

## State endpoint

For host app extensions, we would need to compute the set of active hostapp extensions and then when iterating over the release `release_image` we would need to device which applications to send over the target state.

Calculating the hostapp active set:

```javascript
export const resolveActiveHostappExtensions = (
    device: ...,
	application: ...,
): ReadonlySet<string> => {
	const hostappExtensions =
		device != null &&
		(device.device_hostapp_extension.length > 0 ||
			device.overrides_hostapp_extensions)
			? device.device_hostapp_extension
			: (application?.application_hostapp_extension ?? []);
	return new Set(
		hostappExtensions.map(
			({ activates__hostapp_extension }) => activates__hostapp_extension,
		),
	);
};
```

Now, on this point on the v3 state endpoint: <https://github.com/balena-io/open-balena-api/blob/master/src/features/device-state/routes/state-get-v3.ts#L157>

We can use the above set, now properly into the `profiles` part of the feature to skip or include its `release_image` with

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

For balena-api this is **open discussion and needs product input,** the main question is, what permission does a user need to set the hostapp extensions of a fleet? and of a device?

## Field allowlist definitions

TODO

## Hostapp (and profiles) discovery

TODO

## Extra metadata

This is future speculation but just so its draft and clear that this is considered for this building: we can attatch metadata (which can come from anywhere, including `balena.yaml`). **The current DB model makes no assumption on how we will want to manage this metadata** — whether it should live **per release extension** (scoped to a specific release's `image profile` row, the shared build-time tag this proposal already routes hostapp extensions through) or **per app extension** (a single source of truth shared across every release of an app that declares a same-named hostapp extension). Nothing in the shipped schema forecloses either path. The two ideas aren't mutually exclusive either — behavioral fields (e.g. `requires reboot`) could stay per release extension while presentational fields (e.g. logo, description) live per app extension, with both existing side by side.

One difference from the generalized-profiles proposal is worth calling out here: since this proposal keeps hostapp extensions as their own entity (`application_hostapp_extension` / `device_hostapp_extension`), separate from any future generic "profiles" activation (see "Hostapps Extensions vs Profiles" above), an app-level metadata catalog would be scoped specifically to hostapp extensions, keyed by `(application, hostapp_extension)` — not to profiles in general. If the anticipated follow-up "application activates profiles" feature is added later, it would need its own equivalent catalog, or the two entities would need unifying first.

### Option A — per release extension (scoped to `image profile`)

These live alongside the `release image` table as new fields on `image profile` itself — e.g. a logo added as a WebResource `profile logo` field, a `requires reboot` boolean field, and so on. Each release re-declares its own metadata at build time, so an old release keeps showing exactly what it declared even if a later release changes the logo/description/reboot-requirement for a same-named extension.

- **Pro**: correctness by construction. A device pinned to an old release can never show metadata that release didn't actually ship with — "does enabling this extension reboot my device" always has one unambiguous answer, the one the running release declared.
- **Con**: if an extension spans multiple services/images within the same release, this metadata gets duplicated across every `image profile` row for that release (same value repeated N times, expected to agree, nothing enforcing it).

### Option B — per app extension (single source of truth, future evolution)

A separate table, keyed by `(application, hostapp_extension)`, holding metadata shared across every release that declares that extension name — needs its own name since `application_hostapp_extension` is already taken by the run-time activation table. The idea is that this would be populated the first time a given `(application, hostapp_extension)` pair is seen at build time, and could then be edited independently of pushes (e.g. by a curator), making it an actual single source of truth rather than whatever the latest push happened to say.

- **Pro**: exactly one logo/description per extension per app — what a "browse hostapp extensions available to this fleet" marketplace-style UI wants, without having to pick a release to read from.
- **Con**: only safe for *purely presentational* metadata. Anything that changes runtime behavior (reboot, size, license agreements, etc.) can't live here without breaking Option A's correctness guarantee — if release X requires a reboot and release Y doesn't, "does the app extension require a reboot" has no single correct answer, so behavioral metadata has to stay release-scoped regardless of whether Option B ships.

## TODOS:

**Do we need profile groups?** If so, it can be done on top of the above modeling, if not necessary we can bypass.

**Concurrency issues with multiple posts?** E.g. If we want to activate multiple profiles we would need several POST /application_profile or /device_profile in a single transaction. The chances of a state endpoint get in the middle of concurrent POSTs is low but not zero - We can probably solve with a custom api route or with proper implementation of $batch - IMO, this is not a blocker for the MVP.

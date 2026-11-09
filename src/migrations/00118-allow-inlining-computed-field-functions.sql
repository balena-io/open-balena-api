-- Recreate the computed field functions without the `FROM (SELECT "<table>".*) AS "<table>"` wrapper,
-- which stopped postgres from inlining them, matching what @balena/abstract-sql-compiler 11.3.49 generates.

CREATE OR REPLACE FUNCTION "fn_device_should be running-release"("device" "device")
RETURNS INTEGER AS $fn$
SELECT CASE
	WHEN "device"."is pinned on-release" IS NOT NULL THEN "device"."is pinned on-release"
	ELSE (
		SELECT "a"."should be running-release"
		FROM "application" AS "a"
		WHERE "a"."id" = "device"."belongs to-application"
	)
END
	$fn$ LANGUAGE SQL STABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION "fn_device_overall status"("device" "device")
RETURNS VARCHAR(255) AS $fn$
SELECT CASE
	WHEN FALSE THEN 'inactive'
	WHEN "device"."provisioning state" = 'Post-Provisioning' THEN 'post-provisioning'
	WHEN NOT (
			"device"."is connected to vpn"
		)
		AND "device"."last connectivity event" IS NULL
		AND "device"."api heartbeat state" = 'unknown' THEN 'configuring'
	WHEN NOT (
			"device"."is connected to vpn"
		)
		AND "device"."api heartbeat state" IN ('offline', 'unknown') THEN 'disconnected'
	WHEN "device"."api heartbeat state" IN ('online', 'timeout')
		AND "device"."download progress" IS NOT NULL
		AND "device"."status" = 'Downloading' THEN 'updating'
	WHEN "device"."provisioning progress" IS NOT NULL THEN 'configuring'
	WHEN "device"."api heartbeat state" IN ('online', 'timeout')
		AND EXISTS (
			SELECT 1
			FROM "image install" AS "ii"
			WHERE "ii"."device" = "device"."id"
			AND "ii"."download progress" IS NOT NULL
			AND "ii"."status" = 'Downloading'
		) THEN 'updating'
	WHEN ("device"."api heartbeat state" = 'timeout'
		OR "device"."is connected to vpn"
		AND "device"."api heartbeat state" != 'online'
		OR NOT (
			"device"."is connected to vpn"
		)
		AND "device"."api heartbeat state" = 'online'
		AND COALESCE((
			SELECT "dcv"."value"
			FROM "device config variable" AS "dcv"
			WHERE "dcv"."device" = "device"."id"
			AND "dcv"."name" IN ('BALENA_SUPERVISOR_VPN_CONTROL', 'RESIN_SUPERVISOR_VPN_CONTROL')
			ORDER BY "dcv"."name" ASC
			LIMIT 1
		), (
			SELECT "acv"."value"
			FROM "application config variable" AS "acv"
			WHERE "acv"."application" = "device"."belongs to-application"
			AND "acv"."name" IN ('BALENA_SUPERVISOR_VPN_CONTROL', 'RESIN_SUPERVISOR_VPN_CONTROL')
			ORDER BY "acv"."name" ASC
			LIMIT 1
		), 'not set') != 'false') THEN 'reduced-functionality'
	ELSE 'operational'
END
	$fn$ LANGUAGE SQL STABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION "fn_device_overall progress"("device" "device")
RETURNS INTEGER AS $fn$
SELECT CASE
	WHEN FALSE THEN NULL
	WHEN "device"."provisioning state" = 'Post-Provisioning' THEN "device"."provisioning progress"
	WHEN NOT (
			"device"."is connected to vpn"
		)
		AND "device"."last connectivity event" IS NULL
		AND "device"."api heartbeat state" = 'unknown' THEN "device"."provisioning progress"
	WHEN NOT (
			"device"."is connected to vpn"
		)
		AND "device"."api heartbeat state" IN ('offline', 'unknown') THEN NULL
	WHEN "device"."download progress" IS NOT NULL
		AND "device"."status" = 'Downloading' THEN "device"."download progress"
	WHEN "device"."provisioning progress" IS NOT NULL THEN "device"."provisioning progress"
	WHEN EXISTS (
			SELECT 1
			FROM "image install" AS "ii"
			WHERE "ii"."device" = "device"."id"
			AND "ii"."download progress" IS NOT NULL
			AND "ii"."status" = 'Downloading'
		) THEN (
		SELECT CAST(ROUND(AVG(COALESCE("ii"."download progress", 100))) AS INTEGER)
		FROM "image install" AS "ii"
		WHERE "ii"."device" = "device"."id"
		AND "ii"."status" != 'deleted'
		AND ("ii"."status" = 'Downloading'
		OR "ii"."is provided by-release" = COALESCE("device"."is pinned on-release", (
			SELECT "a"."should be running-release"
			FROM "application" AS "a"
			WHERE "device"."belongs to-application" = "a"."id"
		)))
	)
END
	$fn$ LANGUAGE SQL STABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION "fn_release_semver"("release" "release")
RETURNS VARCHAR(255) AS $fn$
SELECT (("release"."semver major" || '.' || "release"."semver minor" || '.' || "release"."semver patch") || CAST(CASE
	WHEN "release"."semver prerelease" != '' THEN ('-' || "release"."semver prerelease")
	ELSE ''
END AS TEXT) || CAST(CASE
	WHEN "release"."semver build" != '' THEN ('+' || "release"."semver build")
	ELSE ''
END AS TEXT))
	$fn$ LANGUAGE SQL STABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION "fn_release_raw version"("release" "release")
RETURNS VARCHAR(255) AS $fn$
SELECT ((("release"."semver major" || '.' || "release"."semver minor" || '.' || "release"."semver patch") || (CAST(CASE
	WHEN ("release"."semver prerelease" != ''
		OR "release"."revision" IS NULL) THEN '-'
	ELSE ''
END AS TEXT) || CONCAT_WS('.', CAST(CASE
	WHEN "release"."semver prerelease" != '' THEN "release"."semver prerelease"
END AS TEXT), CAST(CASE
	WHEN "release"."revision" IS NULL THEN CAST(FLOOR(EXTRACT(EPOCH FROM "release"."created at") * 1000) AS TEXT)
END AS TEXT)))) || CAST(CASE
	WHEN ("release"."semver build" != ''
		OR "release"."revision" > 0
		OR "release"."variant" != '') THEN '+'
	ELSE ''
END AS TEXT) || CONCAT_WS('.', CAST(CASE
	WHEN "release"."semver build" != '' THEN "release"."semver build"
END AS TEXT), CAST(CASE
	WHEN "release"."revision" > 0
		AND NOT (
			('.' || "release"."semver build" || '.') LIKE ('%.' || ('rev' || "release"."revision") || '.%')
		) THEN ('rev' || "release"."revision")
END AS TEXT), CAST(CASE
	WHEN "release"."variant" != '' THEN "release"."variant"
END AS TEXT)))
	$fn$ LANGUAGE SQL STABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION "fn_release_version"("release" "release")
RETURNS JSONB AS $fn$
SELECT CAST(('{"raw": "' || ((("release"."semver major" || '.' || "release"."semver minor" || '.' || "release"."semver patch") || (CAST(CASE
	WHEN ("release"."semver prerelease" != ''
		OR "release"."revision" IS NULL) THEN '-'
	ELSE ''
END AS TEXT) || CONCAT_WS('.', CAST(CASE
	WHEN "release"."semver prerelease" != '' THEN "release"."semver prerelease"
END AS TEXT), CAST(CASE
	WHEN "release"."revision" IS NULL THEN CAST(FLOOR(EXTRACT(EPOCH FROM "release"."created at") * 1000) AS TEXT)
END AS TEXT)))) || CAST(CASE
	WHEN ("release"."semver build" != ''
		OR "release"."revision" > 0
		OR "release"."variant" != '') THEN '+'
	ELSE ''
END AS TEXT) || CONCAT_WS('.', CAST(CASE
	WHEN "release"."semver build" != '' THEN "release"."semver build"
END AS TEXT), CAST(CASE
	WHEN "release"."revision" > 0
		AND NOT (
			('.' || "release"."semver build" || '.') LIKE ('%.' || ('rev' || "release"."revision") || '.%')
		) THEN ('rev' || "release"."revision")
END AS TEXT), CAST(CASE
	WHEN "release"."variant" != '' THEN "release"."variant"
END AS TEXT))) || '","major": ' || "release"."semver major" || ',"minor": ' || "release"."semver minor" || ',"patch": ' || "release"."semver patch" || ',"prerelease": [' || CONCAT_WS(',', CAST(CASE
	WHEN "release"."semver prerelease" != '' THEN ('"' || REPLACE("release"."semver prerelease", '.', '","') || '"')
END AS TEXT), CAST(CASE
	WHEN "release"."revision" IS NULL THEN CAST(FLOOR(EXTRACT(EPOCH FROM "release"."created at") * 1000) AS TEXT)
END AS TEXT)) || '],"build": [' || CONCAT_WS(',', CAST(CASE
	WHEN "release"."semver build" != '' THEN ('"' || REPLACE("release"."semver build", '.', '","') || '"')
END AS TEXT), CAST(CASE
	WHEN "release"."revision" > 0
		AND NOT (
			('.' || "release"."semver build" || '.') LIKE ('%.' || ('rev' || "release"."revision") || '.%')
		) THEN ('"' || ('rev' || "release"."revision") || '"')
END AS TEXT), CAST(CASE
	WHEN "release"."variant" != '' THEN ('"' || "release"."variant" || '"')
END AS TEXT)) || '],"version": "' || (("release"."semver major" || '.' || "release"."semver minor" || '.' || "release"."semver patch") || (CAST(CASE
	WHEN ("release"."semver prerelease" != ''
		OR "release"."revision" IS NULL) THEN '-'
	ELSE ''
END AS TEXT) || CONCAT_WS('.', CAST(CASE
	WHEN "release"."semver prerelease" != '' THEN "release"."semver prerelease"
END AS TEXT), CAST(CASE
	WHEN "release"."revision" IS NULL THEN CAST(FLOOR(EXTRACT(EPOCH FROM "release"."created at") * 1000) AS TEXT)
END AS TEXT)))) || '"}') AS JSONB)
	$fn$ LANGUAGE SQL STABLE PARALLEL SAFE;

CREATE OR REPLACE FUNCTION "fn_application profile catalog_available since-release"("application profile catalog" "application profile catalog")
RETURNS INTEGER AS $fn$
SELECT (
	SELECT "r"."id"
	FROM "release" AS "r"
	WHERE "r"."belongs to-application" = "application profile catalog"."application"
	AND "r"."status" = 'success'
	AND EXISTS (
		SELECT 1
		FROM "image-is part of-release" AS "ri"
		WHERE "ri"."is part of-release" = "r"."id"
		AND EXISTS (
			SELECT 1
			FROM "image profile" AS "ip"
			WHERE "ip"."release image" = "ri"."id"
			AND "ip"."profile name" = "application profile catalog"."catalogs-profile name"
		)
	)
	ORDER BY "r"."semver major" ASC,
		"r"."semver minor" ASC,
		"r"."semver patch" ASC,
		"r"."revision" ASC,
		"r"."variant" DESC,
		"r"."created at" ASC
	LIMIT 1
)
	$fn$ LANGUAGE SQL STABLE PARALLEL SAFE;

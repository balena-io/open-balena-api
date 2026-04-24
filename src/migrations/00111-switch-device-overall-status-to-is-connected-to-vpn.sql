CREATE OR REPLACE FUNCTION public."fn_device_overall progress"(device device)
	RETURNS integer
	LANGUAGE sql
	STABLE PARALLEL SAFE
AS $function$
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
FROM (
	SELECT "device".*
) AS "device"
	$function$
;

CREATE OR REPLACE FUNCTION public."fn_device_overall status"(device device)
	RETURNS character varying
	LANGUAGE sql
	STABLE PARALLEL SAFE
AS $function$
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
FROM (
	SELECT "device".*
) AS "device"
	$function$
;

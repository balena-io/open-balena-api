UPDATE "device"
SET "os variant" = (
	CASE WHEN "os variant" = 'development' THEN 'dev'
	WHEN "os variant" = 'production' THEN 'prod'
	ELSE NULL
	END
)
WHERE "os variant" IS NOT NULL
AND "os variant" NOT IN ('prod', 'dev');

UPDATE "release"
SET "source" = 'local'
WHERE "source" NOT IN ('cloud', 'local');

UPDATE "image install"
SET "status" = (
	CASE WHEN "status" = 'running' THEN 'Running'
	WHEN "status" = 'downloading' THEN 'Downloading'
	ELSE 'Unknown'
	END
)
WHERE "status" NOT IN (
	'Stopping',
	'Stopped',
	'Downloading',
	'Downloaded',
	'Installing',
	'Installed',
	'Starting',
	'Running',
	'Idle',
	'Handing over',
	'Awaiting handover',
	'Deleting',
	'deleted',
	'Dead',
	'paused',
	'restarting',
	'removing',
	'exited',
	'configuring',
	'Unknown'
);

UPDATE "image"
SET "project type" = NULL
WHERE "project type" IS NOT NULL
AND "project type" NOT IN (
	'Standard Dockerfile',
	'project type unavailable',
	'NodeJS',
	'node.js',
	'local deploy',
	'external service',
	'Dockerfile.template',
	'dockerfile template',
	'dockerfile',
	'Could not be detected',
	'Architecture-specific Dockerfile',
	'Archicture-specific Dockerfile'
);

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'cpu architecture'
			AND tc.constraint_name = 'cpu architecture_slug_check'
	) THEN
		ALTER TABLE "cpu architecture" ADD CONSTRAINT "cpu architecture_slug_check" CHECK (
			("slug" IN ('rpi', 'armv7hf', 'aarch64', 'i386-nlp', 'i386', 'amd64'))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'device'
			AND tc.constraint_name = 'device_os variant_check'
	) THEN
		ALTER TABLE "device" ADD CONSTRAINT "device_os variant_check" CHECK (
			("os variant" IN ('prod', 'dev'))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image install'
			AND tc.constraint_name = 'image install_status_check'
	) THEN
		ALTER TABLE "image install" ADD CONSTRAINT "image install_status_check" CHECK (
			("status" IN ('Stopping', 'Stopped', 'Downloading', 'Downloaded', 'Installing', 'Installed', 'Starting', 'Running', 'Idle', 'Handing over', 'Awaiting handover', 'Deleting', 'deleted', 'Dead', 'paused', 'restarting', 'removing', 'exited', 'configuring', 'Unknown'))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image'
			AND tc.constraint_name = 'image_project type_check'
	) THEN
		ALTER TABLE "image" ADD CONSTRAINT "image_project type_check" CHECK (
			("project type" IN ('Standard Dockerfile', 'project type unavailable', 'NodeJS', 'node.js', 'local deploy', 'external service', 'Dockerfile.template', 'dockerfile template', 'dockerfile', 'Could not be detected', 'Architecture-specific Dockerfile', 'Archicture-specific Dockerfile'))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'image'
			AND tc.constraint_name = 'image_status_check'
	) THEN
		ALTER TABLE "image" ADD CONSTRAINT "image_status_check" CHECK (
			("status" IN ('running', 'success', 'failed', 'error', 'cancelled', 'interrupted'))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release_source_check'
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release_source_check" CHECK (
			("source" IN ('cloud', 'local'))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'release'
			AND tc.constraint_name = 'release_status_check'
	) THEN
		ALTER TABLE "release" ADD CONSTRAINT "release_status_check" CHECK (
			("status" IN ('running', 'success', 'failed', 'error', 'cancelled', 'interrupted'))
		);
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints tc
		WHERE tc.CONSTRAINT_TYPE = 'CHECK'
			AND tc.table_schema = CURRENT_SCHEMA()
			AND tc.table_name = 'service instance'
			AND tc.constraint_name = 'service instance_service type_check'
	) THEN
		ALTER TABLE "service instance" ADD CONSTRAINT "service instance_service type_check" CHECK (
			("service type" IN ('vpn'))
		);
	END IF;
END;
$$;

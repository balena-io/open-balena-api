#!/bin/bash
set -e

cleanup () {
	exitCode=$?
	docker compose -f docker-compose.test-custom.yml down
	echo "Exiting with code: $exitCode"
	exit $exitCode
}
trap cleanup EXIT

docker compose -f docker-compose.test-custom.yml run \
	--env NODE_ENV=production \
	--env GENERATE_CONFIG=.materialized-config.json \
	sut bash -c "npx mocha && npm run check-model-types-generated"

# ensure redis and db have clean volumes
docker compose -f docker-compose.test-custom.yml up --force-recreate --renew-anon-volumes -d db redis loki minio-server minio-client
docker compose -f docker-compose.test-custom.yml run --env PINEJS_QUEUE_CONCURRENCY=1 --env NODE_ENV=production sut npx mocha

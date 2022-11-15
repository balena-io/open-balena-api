#!/bin/bash
set -e

cleanup () {
	docker compose -f docker-compose.test-custom.yml down
}
trap cleanup EXIT

docker compose -f docker-compose.test-custom.yml build

cp src/balena-model.ts src/balena-model.ts.bak
docker compose -f docker-compose.test-custom.yml run --env NODE_ENV=production --env GENERATE_CONFIG=.materialized-config.json sut /bin/bash -c "npx mocha && npm run _generate-model-types"
if ! diff -q src/balena-model.ts src/balena-model.ts.bak > /dev/null; then
	echo 'Types were out of date, please commit the updated version if running locally, otherwise use `npm run generate-model-types` to regenerate them locally'
	exit 1
fi;

rm src/balena-model.ts.bak

docker compose -f docker-compose.test-custom.yml up --force-recreate --renew-anon-volumes sut
#!/bin/bash
set -e

cleanup () {
	docker compose -f docker-compose.test.yml down
}
trap cleanup EXIT

docker compose -f docker-compose.test.yml up --force-recreate --renew-anon-volumes sut
#!/bin/sh
set -e

. "$(dirname $0)/common.sh"

cleanup () {
	teardown '' $api_id $db_id $redis_id $loki_id
}
trap cleanup EXIT

build $IMAGE_NAME
db_id=$(rundb)
redis_id=$(runredis)
loki_id=$(runloki)
api_id=$(runapi $IMAGE_NAME $db_id $redis_id $loki_id)
setup $api_id

docker exec $api_id /bin/sh -c 'npx mocha'

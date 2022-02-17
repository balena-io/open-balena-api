#!/bin/bash
set -e

CONFIG_FILE="$(pwd)/.fasttest"

. "$(dirname $0)/common.sh"

db_id=$(sed -n "1{p;q;}" "$CONFIG_FILE" 2>/dev/null) || true
redis_id=$(sed -n "2{p;q;}" "$CONFIG_FILE" 2>/dev/null) || true
loki_id=$(sed -n "3{p;q;}" "$CONFIG_FILE" 2>/dev/null) || true
api_id=$(sed -n "4{p;q;}" "$CONFIG_FILE" 2>/dev/null) || true


external=''
test_files=''
teardown=0
stop=0
extra_env=''
extra_args=''

while [[ $# -gt 0 ]]; do
	key=$1
	shift
	case $key in
		--teardown)
			teardown=1
		;;
		--stop)
			stop=1
		;;
		--long-stack)
			extra_env="${extra_env} --env BLUEBIRD_LONG_STACK_TRACES=1"
		;;
		--debug)
			extra_env="${extra_env} --env DEBUG=1"
		;;
		--profile)
			extra_args="${extra_args} --inspect-brk=0.0.0.0"
		;;
		--generate-config)
			echo "Generating config as $1"
			echo
			extra_env="${extra_env} --env GENERATE_CONFIG=$1"
			shift
		;;
		*)
			test_files="$test_files --spec ./test/*$key*"
		;;
	esac
done

if [[ $teardown -eq 1 ]]; then
	echo 'Tearing down test environment...'
	teardown $IMAGE_NAME $db_id $redis_id $loki_id $api_id
	rm "$CONFIG_FILE" 2>/dev/null || true
	exit 0
fi

if [[ $stop -eq 1 ]]; then
	echo 'Stopping test environment containers...'
	docker stop $api_id $db_id $redis_id $loki_id 2>/dev/null || true
	exit 0
fi

if [ -z "$db_id" ] || [ -z "$redis_id" ] || [ -z "$loki_id" ] || [ -z "$api_id" ]; then
	echo 'Creating test environment...'

	# cleanup stray containers
	teardown $IMAGE_NAME $db_id $api_id

	# rebuild
	build $IMAGE_NAME

	db_id=$(rundb '-p 5431:5432')
	echo $db_id >"$CONFIG_FILE"

	redis_id=$(runredis '-p 6378:6379')
	echo $redis_id >>"$CONFIG_FILE"

	loki_id=$(runloki '-p 3100:3100')
	echo $loki_id >>"$CONFIG_FILE"

	api_id=$(runapi $IMAGE_NAME $db_id $redis_id $loki_id " -p 9228:9229 -v $(pwd):/usr/src/app")
	echo $api_id >>"$CONFIG_FILE"

	# run prettier once before the initial setup, so that `npm run lint` does not fail
	npm run prettify

	setup $api_id
else
	docker start $db_id $redis_id $loki_id $api_id
fi

echo '-----------------------------------------------------------------------'
echo 'Using containers:'
echo "  API: $api_id"
echo "   DB: $db_id"
echo "Redis: $redis_id"
echo " Loki: $loki_id"
echo '-----------------------------------------------------------------------'

echo 'Clearing database'
docker exec $db_id /bin/sh -c "psql --username=docker --dbname=postgres --command='DROP SCHEMA \"public\" CASCADE; CREATE SCHEMA \"public\";'"

echo 'Clearing Redis'
docker exec $redis_id /bin/sh -c "redis-cli flushall"

if [[ -z "$test_files" ]]; then
	echo "Running all tests"
else
	echo "Running tests:$test_files"
fi

docker exec ${extra_env} -it $api_id ./node_modules/.bin/mocha $test_files --bail ${extra_args}

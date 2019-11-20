#!/bin/sh
set -e

teardown () {
	local image_name=$1
	local db_id=$2
	local redis_id=$3
	local api_id=$4
	docker rm -fv $api_id $db_id $redis_id 2>/dev/null || true
	docker rmi $image_name 2>/dev/null || true
}

build () {
	local image_name=$1
	docker pull 'balena/open-balena-db:master' &
	db=$!
	docker pull 'redis:alpine' &
	redis=$!
	docker build --cache-from=$image_name --tag $image_name .
	wait $db
	wait $redis
}

rundb () {
	docker run $1 -d 'balena/open-balena-db:master'
}

runredis () {
	docker run $1 -d 'redis:alpine'
}

runapi () {
	local image_name=$1
	local db_id=$2
	local redis_id=$3
	local extra_vol_args=$4
	local extra_env_args=$5

	docker run -d \
		--privileged \
		--link $db_id \
		--link $redis_id \
		-v /sys/fs/cgroup:/sys/fs/cgroup:ro \
		-e API_HOST=127.0.0.1 \
		-e API_VPN_SERVICE_API_KEY=api_vpn_service_api_key \
		-e BLUEBIRD_DEBUG=1 \
		-e BLUEBIRD_LONG_STACK_TRACES=0 \
		-e COOKIE_SESSION_SECRET=fuschia \
		-e DATABASE_URL=postgres://docker:docker@$db_id:5432/postgres \
		-e DEBUG= \
		-e DELTA_HOST=delta_host.com \
		-e DEVICE_CONFIG_OPENVPN_CA='LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0tCk1JSUNXRENDQWNHZ0F3SUJBZ0lKQVBTeHZhSG5zanVpTUEwR0NTcUdTSWIzRFFFQkJRVUFNRVV4Q3pBSkJnTlYKQkFZVEFrRlZNUk13RVFZRFZRUUlEQXBUYjIxbExWTjBZWFJsTVNFd0h3WURWUVFLREJoSmJuUmxjbTVsZENCWAphV1JuYVhSeklGQjBlU0JNZEdRd0hoY05NVE14TWpFeU1UUTBOelUyV2hjTk1qTXhNakV3TVRRME56VTJXakJGCk1Rc3dDUVlEVlFRR0V3SkJWVEVUTUJFR0ExVUVDQXdLVTI5dFpTMVRkR0YwWlRFaE1COEdBMVVFQ2d3WVNXNTAKWlhKdVpYUWdWMmxrWjJsMGN5QlFkSGtnVEhSa01JR2ZNQTBHQ1NxR1NJYjNEUUVCQVFVQUE0R05BRENCaVFLQgpnUURsTXZRMmp1WnJ6WFJxV3BYN3Q0RlhYTGw0RzhuY05UMXYyTW1UM3BwNnVGNG5rVkd1UjRZdFczYmlwQ0thClRYRnZ5aFp1eEUvN2ZKWUdoYWZNV1pzMjZrUHQ3dnNtaVRSRUVHQytCSHFOUWIwd0ltckxaT0syVzk3R2R1U2UKZThuWmNXU0MzWjhVQ1hSQkg3WmtzNHphRndodGNnZ3ZkSi9Qdzl3MTJ0Tkl6UUlEQVFBQm8xQXdUakFkQmdOVgpIUTRFRmdRVVU0V3FYMmZMeDdnVTJRcFF2VkgwblpOUXNSWXdId1lEVlIwakJCZ3dGb0FVVTRXcVgyZkx4N2dVCjJRcFF2VkgwblpOUXNSWXdEQVlEVlIwVEJBVXdBd0VCL3pBTkJna3Foa2lHOXcwQkFRVUZBQU9CZ1FBWWhUTWQKUHNDQ3hIbHFCak91c3dQNlBZT2c1TXo1QXFnNzBaWmZoTGpFV3lvU0VzclZKTTRlcyt4cnRIQUl0VDI4QXhreQpSUE43cnpMc2QzR2lIOWE2V3phZU5kcFdkWU1TaTMrTnJOYmtPU3ZuTmhHeHUvUUhiMEx0bWV0eHBENlNERmZQCkoxMUVuTjM0dldHMUpCWUh2NVNvditFOTkzclJKdkU0VUV1bFpRPT0KLS0tLS1FTkQgQ0VSVElGSUNBVEUtLS0tLQo=' \
		-e DEVICE_CONFIG_SSH_AUTHORIZED_KEYS='ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAACAQCc5cLVsu7b52tzxwa8A6cs4LC2I+IMtyKeVZFVAWdhfEWGEJL78rn0tC4YmHBSWW0hBeZmn8f7ZKcZ/r1W2RpuH7wpUc56/3hffJ0GoktMOX69pjNsE3rWr8/cZbl/LaJjeHBpyFZ6VimYl5KiYyHJH7RZwlEYYiJ2YDCbte51jvmotFTqiOJNPCM3SXWFjsUGDOWwNi7GDxG+ulb0cBnYzyYlHTj5dS/uya0v8S267TYO2jZ9lUvZHYYQBilYoN3qT79B/lRJq/AKsaSPI2VWkwoAWLObJRjQjoIsClxcfaSfRg6fgdezv3saeorVMIdEYAj3CQVmLszCNGC8dgqB9OoKdjd/OUG/bFUc86S+y0dZX3vqKBfZjE1dHNzNkQeulsbRj0FGFTxFYL0Ng7jlr98iXusnNg236LGsBTeod2MLfMRsrOc0Utfc5Pq2Zkyak4aJ6URBFqZnKlJwvI3AFznxvHD1PmIrwzCCmLA409v3WbXEK4KZrUIs81wlQWAK3919ViozdnR23f4hZtq3P5M6AbnMMdIOB1jDjPK//eaTMf3erHVa0nTMMwScBDnrT86yJBBEwpUVpIp6YUBFaVMQscX3gBTd+RyOU9jOvyinGjosJfF38qsMJTNHh48zgic5sSLhtPQgkUjWhpcnfjqrLRewKbVd+VZQc1WsdQ==' \
		-e IMAGE_MAKER_URL=https://img.balenadev.io \
		-e IMAGE_STORAGE_BUCKET=balena-dev-img \
		-e IMAGE_STORAGE_ENDPOINT=s3.balenadev.io \
		-e IMAGE_STORAGE_PREFIX=images \
		-e IMAGE_STORAGE_ACCESS_KEY=ACCESS_KEY \
		-e IMAGE_STORAGE_SECRET_KEY=SECRET_KEY \
		-e JSON_WEB_TOKEN_EXPIRY_MINUTES=10080 \
		-e JSON_WEB_TOKEN_SECRET=purple \
		-e MIXPANEL_TOKEN=mixpanel_token \
		-e NUM_WORKERS=1 \
		-e PORT=80 \
		-e REDIS_HOST=$redis_id \
		-e REDIS_PORT=6379 \
		-e REGISTRY2_HOST=registry2.balenadev.io \
		-e REQUEST_MOCK_DEBUG=0 \
		-e SUPERUSER_EMAIL=test@balena.io \
		-e SUPERUSER_PASSWORD=Password01 \
		-e TOKEN_AUTH_BUILDER_TOKEN=token_auth_builder_token \
		-e TOKEN_AUTH_CERT_ISSUER='api.balenadev.io' \
		-e TOKEN_AUTH_CERT_KEY='LS0tLS1CRUdJTiBFQyBQUklWQVRFIEtFWS0tLS0tCk1IY0NBUUVFSUs0VWtLQ1RFamlJamtNVnNtaG96emhScmxrZ2REOU1RN01jdWd2MFZTbHhvQW9HQ0NxR1NNNDkKQXdFSG9VUURRZ0FFYVZQN21pUGdTU0JTWjBLYnp4L2pvZnVlWE1KVHpITkpuYno2enlTWHBJS1I3RzFXQkROYwpRRXZpWFZqUk45MWVybHdSMDNITWpjUm81Ymt4b2gzREdnPT0KLS0tLS1FTkQgRUMgUFJJVkFURSBLRVktLS0tLQo=' \
		-e TOKEN_AUTH_CERT_KID='NVJXMzpRREhTOldDUjQ6NzdLUjpVSTJZOldPS086UTUzVTpNUFVXOlFWRVA6QUZZWDpBMkMyOkRLNDcK' \
		-e TOKEN_AUTH_CERT_PUB='LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUZrd0V3WUhLb1pJemowQ0FRWUlLb1pJemowREFRY0RRZ0FFYVZQN21pUGdTU0JTWjBLYnp4L2pvZnVlWE1KVAp6SE5KbmJ6Nnp5U1hwSUtSN0cxV0JETmNRRXZpWFZqUk45MWVybHdSMDNITWpjUm81Ymt4b2gzREdnPT0KLS0tLS1FTkQgUFVCTElDIEtFWS0tLS0tCg==' \
		-e TOKEN_AUTH_JWT_ALGO=ES256 \
		-e VPN_HOST=vpn.balenadev.io \
		-e VPN_POLL_INTERVAL=5 \
		-e VPN_PORT=5433 \
		-e VPN_SERVICE_API_KEY=vpn_service_api_key \
		-e VPN_SERVICE_CONNECTIONS=5 \
		-e SUPERUSER_EMAIL=balena-admin@example.com\
		-e SUPERUSER_PASSWORD=foobarbaz\
		$extra_vol_args \
		$extra_env_args \
		$image_name
}

setup () {
	local api_id=$1

	docker exec $api_id /bin/sh -c 'npm ci && npm run lint' &
	pid=$!

	# mitigate a race-condition related to systemd not having started
	# listening to its dbus socket.
	echo "Waiting for systemd..."
	sleep 2

	docker exec $api_id /bin/sh -c 'systemctl disable open-balena-api && systemctl stop open-balena-api'
	wait $pid
}

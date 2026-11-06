#!/usr/bin/env bash

set -euo pipefail

# Redirect all future stdout/stderr to s6-log
exec > >(exec s6-log p"api[$$]:" 1 || true) 2>&1

# Change to working directory
cd /usr/src/app || exit 1

if [[ "${PRODUCTION_MODE:-}" == "true" ]]; then
	exec node --enable-source-maps index.js
else
	exec node_modules/.bin/supervisor \
		--no-restart-on error \
		--extensions js,node,coffee,sbvr,json,sql,pegjs,ts \
		--watch src \
		-- --enable-source-maps index.js
fi

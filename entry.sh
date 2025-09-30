#!/bin/bash
# shellcheck disable=SC1091

set -euo pipefail

# Redirect all future stdout/stderr to s6-log
exec > >(exec s6-log p"api[$$]:" 1 || true) 2>&1

# Change to working directory
cd /usr/src/app || exit 1

# Load environment variables for this service
source /etc/s6-overlay/scripts/functions.sh
[[ -f "config/env" ]] && load_env_file "config/env"

if [[ "${PRODUCTION_MODE:-}" == "true" ]]; then
	exec node --enable-source-maps --loader @swc-node/register/esm-register index.js
else
	exec node_modules/.bin/supervisor \
		--no-restart-on error \
		--extensions js,node,coffee,sbvr,json,sql,pegjs,ts \
		--watch src \
		-- --enable-source-maps --loader @swc-node/register/esm-register index.js
fi

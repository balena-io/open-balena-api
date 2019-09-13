#!/usr/bin/env bash

TARGET_DIR="${1:-}"

[ ! -z "$TARGET_DIR" ] || (echo "Must specify a target directory to copy the ./dist output to..." && exit 1)

NODE_MODULE_DIR="${TARGET_DIR}/node_modules/@balena/open-balena-api"
echo "Target: ${TARGET_DIR}"
while true; do
    CHANGES="$(fswatch -1 ./src)"

    if [ -z "$CHANGES" ]; then
        continue
    fi
    
    npm run build

    if ! diff -qr "./dist" "${NODE_MODULE_DIR}/dist"; then
        echo "Copying to target..."
        rsync -a "./dist" "${NODE_MODULE_DIR}"
        rsync -a "./node_modules" "${NODE_MODULE_DIR}"
        rsync -a "./package.json" "${NODE_MODULE_DIR}"

        # rm -f "${TARGET_DIR}/.fast-boot.json"
        # rm -rf "${TARGET_DIR}/.ts-node"
        # rm -rf "./dist"
        echo "Done. Waiting for further changes..."
    else
        echo "No changes detected!"
    fi
done

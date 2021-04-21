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

# Run Trivy
sudo apt-get install wget apt-transport-https gnupg lsb-release
wget -qO - https://aquasecurity.github.io/trivy-repo/deb/public.key | sudo apt-key add -
echo deb https://aquasecurity.github.io/trivy-repo/deb $(lsb_release -sc) main | sudo tee -a /etc/apt/sources.list.d/trivy.list
sudo apt-get update
sudo apt-get install trivy
trivy image -f table $IMAGE_NAME
ls # see what the file is called

# Run Grype

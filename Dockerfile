FROM balena/open-balena-base:v13.5.1 as runtime

EXPOSE 80

RUN apt update \
	&& apt install libecpg-dev python3-pip \
	&& rm -rf /var/lib/apt/lists/* \
	&& pip3 install --no-cache-dir setuptools \
	&& pip3 install --no-cache-dir pgsanity

COPY package.json package-lock.json /usr/src/app/
RUN HUSKY=0 npm ci --unsafe-perm --production && npm cache clean --force

COPY . /usr/src/app

RUN npx tsc --noEmit --project ./tsconfig.build.json

COPY config/services/ /etc/systemd/system/

RUN systemctl enable open-balena-api.service

# Set up a test image that can be reused
FROM runtime as test

RUN npm ci && npm run lint && systemctl disable balena-api

# Make the default output be the runtime image
FROM runtime

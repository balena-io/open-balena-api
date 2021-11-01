FROM balena/open-balena-base:v13.0.0

EXPOSE 80

RUN apt update \
	&& apt install libecpg-dev python3-pip \
	&& rm -rf /var/lib/apt/lists/* \
	&& pip3 install --no-cache-dir setuptools \
	&& pip3 install --no-cache-dir pgsanity

COPY package.json package-lock.json /usr/src/app/
RUN npm ci --unsafe-perm --production && npm cache clean --force

COPY . /usr/src/app

RUN npx tsc --noEmit --project ./tsconfig.build.json

COPY config/services/ /etc/systemd/system/

RUN systemctl enable open-balena-api.service

FROM balena/open-balena-base:no-systemd-13.0.4

EXPOSE 80

RUN apt update \
	&& apt install libecpg-dev python3-pip \
	&& rm -rf /var/lib/apt/lists/* \
	&& pip3 install --no-cache-dir setuptools \
	&& pip3 install --no-cache-dir pgsanity

COPY package.json package-lock.json /usr/src/app/
WORKDIR /usr/src/app
RUN npm ci --unsafe-perm --production && npm cache clean --force

COPY . /usr/src/app

RUN npx tsc --noEmit --project ./tsconfig.build.json

CMD [ "/usr/src/app/entry.sh" ]
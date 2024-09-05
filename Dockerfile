FROM ghcr.io/flant/shell-operator:latest
ENV LOG_TYPE=color

RUN apk add --no-cache curl npm nodejs git

WORKDIR /controller
COPY package.json package-lock.json ./
RUN npm install --production

COPY lib ./lib
COPY bin/hook /hooks/hook
FROM node:lts-alpine as build-base
RUN apk add --update --no-cache \
  python3 \
  make \
  g++ \
  bash \
  gcc

FROM build-base AS build
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci
COPY src ./src
COPY tsconfig.json .
RUN npm run build

FROM build-base AS libraries
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:lts-alpine
RUN apk add --update --no-cache dumb-init \
    openjdk17 \
    kubectl \
    jq
ENV NODE_ENV production
COPY ./helm/k8s-jacoco-operator/scripts/coverage.sh /usr/src/
RUN chmod +x /usr/src/coverage.sh
USER node
WORKDIR /usr/src/app
COPY --chown=node:node --from=libraries /usr/src/app/node_modules /usr/src/app/node_modules
COPY --chown=node:node --from=build /usr/src/app/dist/ /usr/src/app/
EXPOSE 3000
CMD ["dumb-init", "node", "app.js"]
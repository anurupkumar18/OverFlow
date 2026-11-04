FROM node:22-alpine
WORKDIR /app
COPY app/ .
ARG APP_VERSION=dev
ENV PORT=8080 APP_VERSION=$APP_VERSION NODE_ENV=production
USER node
EXPOSE 8080
CMD ["node", "server.js"]

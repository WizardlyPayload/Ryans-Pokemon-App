FROM node:22-alpine AS build
WORKDIR /app
COPY api/package.json ./
RUN npm install
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
COPY api/package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations/ ./migrations/
CMD ["node", "dist/index.js"]

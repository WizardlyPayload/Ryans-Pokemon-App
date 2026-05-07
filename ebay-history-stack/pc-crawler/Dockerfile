FROM mcr.microsoft.com/playwright:v1.59.1-jammy
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY pc-crawler/package.json ./
RUN npm install
COPY pc-crawler/tsconfig.json ./
COPY pc-crawler/src ./src
COPY migrations/ ./migrations/
RUN npx tsc
CMD ["node", "dist/index.js"]

FROM mcr.microsoft.com/playwright:v1.59.1-jammy
WORKDIR /app
# Must match npm `playwright` version (see package-lock). Image ships matching /ms-playwright browsers.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
CMD ["node", "dist/index.js"]

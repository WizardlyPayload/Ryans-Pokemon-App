FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app
# Image already ships browser binaries; skip duplicate download during npm install
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
CMD ["node", "dist/index.js"]

# Offizielles Playwright-Image bringt Chromium + alle Systemabhaengigkeiten
# schon fertig mit -- vermeidet die typischen "playwright install" Probleme
# auf schlanken PaaS-Buildern. Version muss zur package.json passen (1.46.x).
FROM mcr.microsoft.com/playwright:v1.46.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]

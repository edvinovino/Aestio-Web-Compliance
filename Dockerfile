# Offizielles Playwright-Image bringt Chromium + alle Systemabhaengigkeiten
# schon fertig mit -- vermeidet die typischen "playwright install" Probleme
# auf schlanken PaaS-Buildern. Version muss exakt zur package.json passen.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]

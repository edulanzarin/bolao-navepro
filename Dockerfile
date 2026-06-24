FROM node:20-bookworm-slim

# Toolchain para o caso de o better-sqlite3 precisar recompilar no host.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    DATA_DIR=/app/data

WORKDIR /app

# Dependências em camada separada para aproveitar o cache.
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# Roda como usuário sem privilégios e garante a posse da pasta de dados.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]

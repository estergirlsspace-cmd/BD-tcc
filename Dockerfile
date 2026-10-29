# C-Warning: Node.js (sem dependências externas) + SQLite (node:sqlite).
FROM node:24-alpine

WORKDIR /app
COPY . .

# O banco fica no volume /data e nunca vem do repositório. Num volume vazio, as tabelas são
# criadas na inicialização e a primeira conta da gestão vem de ADMIN_LOGIN/ADMIN_SENHA.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data

RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000

CMD ["node", "server.js"]

# C-Warning: Node.js (sem dependências externas) + SQLite (node:sqlite).
FROM node:24-alpine

WORKDIR /app
COPY . .

# O banco fica no volume /data. Na primeira execução, ele é criado a partir de data/educacao.sqlite.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data

RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000

CMD ["sh", "-c", "[ -f \"$DATA_DIR/educacao.sqlite\" ] || cp data/educacao.sqlite \"$DATA_DIR/educacao.sqlite\"; exec node server.js"]

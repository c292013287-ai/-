FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./

RUN npm install --registry https://registry.npmmirror.com

COPY . .

RUN npx prisma generate && npm run build

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 3001

CMD ["sh", "-c", "npx prisma generate && npx prisma db push && node dist/index.js"]

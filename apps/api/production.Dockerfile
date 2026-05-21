FROM node:20-alpine AS runner

WORKDIR /app

COPY apps/dist/api/ ./dist/
COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts && \
    npm cache clean --force

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/main.js"]

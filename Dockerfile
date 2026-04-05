# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar archivos de dependencia
COPY package*.json ./

# Instalar todas las dependencias (incluyendo devDeps para tsc)
RUN npm install

# Copiar código fuente y tsconfig
COPY tsconfig.json ./
COPY src/ ./src/

# Compilar TypeScript a JavaScript
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine

WORKDIR /app

# Copiar solo archivos necesarios para producción
COPY package*.json ./

# Instalar solo dependencias de producción
RUN npm install --omit=dev

# Copiar los archivos compilados desde el builder
COPY --from=builder /app/dist ./dist

# Puerto que Render usa por defecto (se sobreescribe con env var)
EXPOSE 3000

# Comando para arrancar el bot (JS compilado)
CMD ["node", "dist/bot/telegram.js"]

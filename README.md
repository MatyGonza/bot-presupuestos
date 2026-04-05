# 🤖 Furniture Pricing Bot (Production Ready)

Bot de Telegram desarrollado en **TypeScript** para la cotización automática de mobiliario a medida mediante Inteligencia Artificial (NLU). Diseñado para procesar solicitudes de audio y texto de forma robusta y segura.

---

## 🚀 Características Principales

- **NLU Multimodal**: Procesa audio (Whisper) y texto (Llama 3.3) mediante **Groq API**.
- **Procesamiento por Lotes**: Cotiza múltiples módulos en un solo mensaje o audio.
- **Gestión de Hardware**: Tres niveles de herrajes (Standard, Premium, Luxury).
- **Consola de Administración**: Métricas en tiempo real (KPIs), gestión de invitaciones y estadísticas de uso.
- **Persistencia Robusta**: Integración con **Supabase** para sesiones, usuarios y presupuestos.

---

## 🛡️ Endurecimiento y Seguridad (Hardening)

Este proyecto ha pasado por una auditoría de seguridad integral ("Judgment Day") aplicando las siguientes defensas:

### 1. Validación de Esquema (Zod)
Todas las solicitudes analizadas por la IA son validadas mediante esquemas de **Zod**. Si la IA genera datos inconsistentes o fuera de rango, el sistema filtra la solicitud por seguridad.

### 2. Rate Limiting (Anti-Abuse)
Implementación de un limitador de frecuencia en memoria que restringe a cada usuario a un máximo de **10 peticiones NLU por minuto**, protegiendo el consumo de las APIs externas.

### 3. Dimension Clamping
Validación estricta de medidas físicas (100mm a 9000mm) directamente en el motor de precios para evitar desbordamientos de cálculo o cotizaciones absurdas.

### 4. Seguridad de Acceso
- Sistema de **Invite-Only** controlado por base de datos.
- Middleware de autorización que bloquea cualquier interacción hasta que el usuario sea validado por el administrador.
- **Strict Environment**: Los secretos y llaves de API están protegidos y nunca se exponen en el repositorio.

---

## 🛠️ Stack Tecnológico

- **Language**: TypeScript
- **Framework**: Grammy (Telegram Bot Framework)
- **DB/Auth**: Supabase
- **AI/NLU**: Groq (Llama-3.3-70b & Whisper-large-v3)
- **Runtime**: Node.js + Docker

---

## 📦 Despliegue en Render.com

El proyecto incluye un `Dockerfile` optimizado para producción.

1. Conectar este repositorio a **Render**.
2. Configurar las variables de entorno:
   - `ADMIN_TELEGRAM_ID`: ID del usuario administrador.
   - `GROQ_API_KEY`: Para el motor NLU.
   - `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`: Para la base de datos.
3. El comando de inicio está pre-configurado para ejecutar el código compilado en `dist/`.

---

## 👨‍💻 Desarrollo

```bash
# Instalar dependencias
npm install

# Compilar para producción
npm run build

# Correr en modo desarrollo
npm run dev
```

---

> [!NOTE]
> Este bot utiliza un **Waste Factor del 20%** configurado en `pricing.ts` para asegurar cotizaciones realistas que cubran cortes y descartes de tableros.

> [!IMPORTANT]
> El sistema de rate limit es volátil (en memoria). Para escalabilidad horizontal excesiva, se recomienda migrar el contador a Redis.

---
**Desarrollado con ❤️ para la industria del mueble.**

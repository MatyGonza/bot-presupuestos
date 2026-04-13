import { Bot, session } from "grammy";
import { supabaseAdapter } from "@grammyjs/storage-supabase";
import http from "http";
import { supabase } from "../db/supabase";
import { authMiddleware } from "./middleware/auth";
import { refreshPrices } from "../engine/pricing";
import * as dotenv from "dotenv";

// Importar Tipos y Routers Nuevos
import { SessionData, MyContext } from "./types";
import { adminRouter } from "./handlers/admin";
import { userRouter } from "./handlers/user";

dotenv.config();

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const adminId = parseInt(process.env.ADMIN_TELEGRAM_ID || "0", 10);

if (!telegramToken) {
  console.error("Falta la variable de entorno TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

// 1. Inicializar el Bot
export const bot = new Bot<MyContext>(telegramToken);

// 2. Configurar Sesiones Supabase (Global)
const storage = supabaseAdapter<SessionData>({
  supabase,
  table: "sessions",
});

bot.use(session({
  initial: (): SessionData => ({ 
    modules: [],
    defaultFrontMaterial: "blanco",
    defaultHardwareTier: "premium",
    defaultInternalThickness: "15mm"
  }),
  storage,
}));

// 3. Middleware de Autorización (Global)
bot.use(authMiddleware);

// 4. Registrar Enrutadores Modulares (Magia copiada de asynctelebot_template)
bot.use(adminRouter);
bot.use(userRouter);

// ── Bootstrap y Salud ─────────────────────────────────────────────────────────

async function main() {
  console.log("[Bootstrap] 🚀 Iniciando bot...");

  // Health Check Server
  const PORT = process.env.PORT || 3000;
  const server = http.createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(PORT, () => {
    console.log(`[Health] ✅ Servidor en puerto ${PORT} (/healthz)`);
  });

  // Configurar Menú — Comandos para TODO el mundo (en chats privados)
  await bot.api.setMyCommands([
    { command: "start", description: "Reiniciar carrito" },
    { command: "config", description: "Cambiar calidades" },
    { command: "resumen", description: "Ver total acumulado" },
    { command: "limpiar", description: "Vaciar carrito" },
    { command: "guardar", description: "Archivar presupuesto" },
    { command: "historial", description: "Ver presupuestos guardados" }
  ], { scope: { type: "all_private_chats" } });

  // Comandos extra — Visibles SÓLO para el admin (en su chat específico)
  if (adminId > 0) {
    await bot.api.setMyCommands([
      { command: "start", description: "Reiniciar carrito" },
      { command: "config", description: "Cambiar calidades" },
      { command: "resumen", description: "Ver total acumulado" },
      { command: "limpiar", description: "Vaciar carrito" },
      { command: "guardar", description: "Archivar presupuesto" },
      { command: "historial", description: "Ver presupuestos guardados" },
      { command: "admin_stats", description: "📊 Ver estadísticas del bot" },
      { command: "admin_invitar", description: "🆕 Generar link de invitación" },
      { command: "admin_usuarios", description: "👥 Ver usuarios registrados" },
      { command: "admin_precios", description: "💰 Gestionar costos (Admin)" }
    ], { scope: { type: "chat", chat_id: adminId } });
    
    console.log(`[Config] Menú de administrador activado para el ID: ${adminId}`);
  }

  // Inicializar Precios
  await refreshPrices();

  console.log("¡Bot iniciado con éxito!");

  // Error Handler
  bot.catch((err) => {
    console.error(`[Global Error] ❌ Error en update ${err.ctx.update.update_id}:`, err.error);
  });

  await bot.start();
}

main().catch(console.error);

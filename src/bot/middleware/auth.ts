import { MyContext } from "../telegram";
import { isUserAllowed } from "../../db/supabase";

const adminId = parseInt(process.env.ADMIN_TELEGRAM_ID || "0", 10);

/**
 * Middleware para proteger el bot.
 * Solo deja pasar si el usuario ya está registrado en Supabase
 * o si es el Admin configurado en el .env.
 */
export async function authMiddleware(ctx: MyContext, next: () => Promise<void>) {
  const userId = ctx.from?.id;

  if (!userId) return; // No procesar si no hay ID de usuario

  // 1. El Admin entra siempre
  if (userId === adminId) {
    return next();
  }

  // 2. Verificar en base de datos
  try {
    const allowed = await isUserAllowed(userId);
    
    if (allowed) {
      return next();
    }
  } catch (error) {
    console.error("[AUTH ERROR]", error);
    // En caso de error de DB, bloqueamos por seguridad
    return ctx.reply("⚠️ Error de conexión con la base de datos de seguridad. Reintentá en un momento.");
  }

  // 3. Bloquear si no está registrado
  // Nota: Dejamos pasar el comando /start porque ahí es donde ocurre el registro.
  const text = ctx.message?.text || "";
  const isStartCommand = text.startsWith("/start") || text.startsWith("/activar");
  
  console.log(`[AUTH] User: ${userId}, Text: "${text}", isStart: ${isStartCommand}`);

  if (isStartCommand) {
    return next();
  }

  console.warn(`[AUTH] ⛔ Acceso bloqueado para: ${userId} (${ctx.from?.first_name || "Desconocido"})`);
  await ctx.reply("⛔ No tenés acceso a este bot.\nPara usarlo, necesitas un link de invitación del administrador.");
}

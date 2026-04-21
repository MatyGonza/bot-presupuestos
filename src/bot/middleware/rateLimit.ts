import { NextFunction } from "grammy";
import { MyContext } from "../types";
import { log } from "../utils/logger";

const MAX_REQUESTS = 10;
const WINDOW_MS = 60_000;
const rateLimitMap = new Map<number, { count: number; resetAt: number }>();

export async function rateLimitMiddleware(ctx: MyContext, next: NextFunction) {
  // Only limit actual messages (text or voice), ignore callbacks and commands except /start
  if (!ctx.message || ctx.message.text?.startsWith('/')) {
    return next();
  }

  const userId = ctx.from?.id;
  if (!userId) return next();

  const now = Date.now();
  let entry = rateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return next();
  }

  if (entry.count >= MAX_REQUESTS) {
    log.warn("RATE", `Usuario ${userId} excedió límite de peticiones`);
    return ctx.reply("⏳ Por favor, esperá un momento. Límite de mensajes frecuentes excedido.");
  }

  entry.count++;
  return next();
}

// Memory cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

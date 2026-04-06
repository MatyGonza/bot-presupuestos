import { Bot, Context, session, SessionFlavor, InlineKeyboard } from "grammy";
import { supabaseAdapter } from "@grammyjs/storage-supabase";
import http from "http";
import { parseAudioToQuote, parseTextToQuote } from "../nlu/parser";
import { calculateQuote, calculateCartTotals } from "../engine/pricing";
import { QuoteResult, QuoteRequestSchema } from "../engine/types";
import { 
  supabase, 
  isUserAllowed,
  registerUser, 
  saveQuote, 
  getQuotesByUser, 
  getQuoteById, 
  createInvitation,
  getStats,
  updateBotSetting
} from "../db/supabase";
import { authMiddleware } from "./middleware/auth";
import { refreshPrices } from "../engine/pricing";
import * as dotenv from "dotenv";

dotenv.config();

const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const adminId = parseInt(process.env.ADMIN_TELEGRAM_ID || "0", 10);

if (!telegramToken) {
  console.error("Falta la variable de entorno TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

// 1. Definir la estructura de la Sesión (Carrito)
interface SessionData {
  modules: QuoteResult[];
  awaitingClientName?: boolean;
  awaitingPriceKey?: string; // Para el flujo de /admin_precios
  defaultFrontMaterial?: "blanco" | "color";
  defaultHardwareTier?: "standard" | "premium" | "luxury";
  defaultInternalThickness?: "18mm" | "15mm";
}

export type MyContext = Context & SessionFlavor<SessionData>;

// 2. Inicializar el Bot
export const bot = new Bot<MyContext>(telegramToken);

// 3. Configurar Sesiones Supabase (Global)
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

// 4. Middleware de Autorización (Global)
bot.use(authMiddleware);

// ── Logger Estructurado ───────────────────────────────────────────────────────
// Centraliza todos los logs con nivel y timestamp para facilitar el debugging
// en producción (Render.com muestra stdout como logs estructurados).

const log = {
  info: (tag: string, msg: string, data?: any) =>
    console.log(`[${new Date().toISOString()}] [INFO] [${tag}] ${msg}`, data ?? ""),
  warn: (tag: string, msg: string, data?: any) =>
    console.warn(`[${new Date().toISOString()}] [WARN] [${tag}] ${msg}`, data ?? ""),
  error: (tag: string, msg: string, err?: any) =>
    console.error(`[${new Date().toISOString()}] [ERROR] [${tag}] ${msg}`, err ?? ""),
};

// ── Rate Limiter In-Memory ─────────────────────────────────────────────────────
// Limita a MAX_REQUESTS peticiones NLU por usuario en una ventana de WINDOW_MS.
// Protege el free tier de Groq (14.400 req/día ≈ 1 req/6s por usuario activo).

const MAX_REQUESTS = 10;  // máx 10 requests NLU
const WINDOW_MS = 60_000; // en una ventana de 1 minuto
const rateLimitMap = new Map<number, { count: number; resetAt: number }>();

function isRateLimited(userId: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  if (entry.count >= MAX_REQUESTS) return true;
  entry.count++;
  return false;
}

// Limpiar el mapa cada 5 minutos para evitar memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);


function formatModuleDetail(mod: QuoteResult): string {
  if (!mod.request) return "";
  const dim = mod.request.dimensions;
  const extras = [];
  if (mod.request.drawerCount) extras.push(`${mod.request.drawerCount} cajones`);
  
  // Detalle de Estantes y Puertas
  if (mod.request.shelfCount && mod.request.shelfCount > 0) {
    extras.push(`${mod.request.shelfCount} estante(s)`);
  }
  if (mod.doorCount > 0) {
    const label = mod.module === 'cajonera' ? 'frentes de cajón' : 'puerta(s)';
    extras.push(`${mod.doorCount} ${label}`);
  }

  const extrasStr = extras.length > 0 ? `\n    🛠 *Componentes:* ${extras.join(", ")}` : "";

  const frontType = mod.request.frontMaterial === 'color' 
    ? "MDF 18mm *Color*" 
    : "MDF 18mm *Blanco*";

  const dimType = mod.request.dimensionsAssumed ? " *(Asumido por defecto estándar)*" : "";
  const hardwareStr = mod.hardwareBreakdown && mod.hardwareBreakdown.length > 0 
    ? `\n    └ Herrajes: ${mod.hardwareBreakdown.join(" | ")}` 
    : "";
  
  const cantoStr = `\n    └ Tapacanto: ${mod.cantoMetersWhite.toFixed(2)}m (B) / ${mod.cantoMetersColor.toFixed(2)}m (C)`;

  const fondoStr = mod.fondosBreakdown && mod.fondosBreakdown.length > 0
    ? `\n    └ Fondos: ${mod.fondosBreakdown.join(" + ")}`
    : "";
    
  return `\n    └ Medidas: ${dim.width}x${dim.height}x${dim.depth} mm${dimType}${extrasStr}${cantoStr}${hardwareStr}${fondoStr}`;
}

function formatProjectReply(sessionData: SessionData, lastAddedBatch: QuoteResult[] | null): string {
  const formatter = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  });

  const cartTotals = calculateCartTotals(sessionData.modules);
  let reply = "";

  if (lastAddedBatch && lastAddedBatch.length > 0) {
    if (lastAddedBatch.length === 1) {
      const mod = lastAddedBatch[0];
      const detailStr = formatModuleDetail(mod);
      reply += `✅ *Módulo Agregado:* ${mod.module.replace('_', ' ').toUpperCase()}\n     (Herrajes: ${formatter.format(mod.hardwareCost)})${detailStr}\n\n`;
    } else {
      reply += `✅ *¡Lote de ${lastAddedBatch.length} Módulos Agregados!*\n\n`;
    }
  }

  reply += `📋 *RESUMEN DEL PROYECTO* 📋\n`;

  if (sessionData.modules.length === 0) {
    reply += `_El carrito está vacío._\n`;
  }

  sessionData.modules.forEach((mod, index) => {
    const detailStr = formatModuleDetail(mod);
    reply += `🔹 *${index + 1}.* ${mod.module.replace('_', ' ').toUpperCase()} - Herrajes: ${formatter.format(mod.hardwareCost)}${detailStr}\n\n`;
  });

  if (sessionData.modules.length > 0) {
    const mat = cartTotals.materials;
    reply += `\n📦 *MATERIALES REQUERIDOS* 📦\n`;
    if (mat.boards18mmWhite > 0) reply += `  └ MDF 18mm Blanco: ${mat.boards18mmWhite} un. -> ${formatter.format(mat.cost18mmWhite)}\n`;
    if (mat.boards18mmColor > 0) reply += `  └ MDF 18mm Color: ${mat.boards18mmColor} un. -> ${formatter.format(mat.cost18mmColor)}\n`;
    if (mat.boards15mmWhite > 0) reply += `  └ MDF 15mm Blanco (Estructural): ${mat.boards15mmWhite} un. -> ${formatter.format(mat.cost15mmWhite)}\n`;
    if (mat.boards3mm > 0) reply += `  └ MDF 3mm Fondo: ${mat.boards3mm} un. -> ${formatter.format(mat.cost3mm)}\n`;
    
    // Tapacantos
    if (cartTotals.totalCantoWhiteMeters > 0) {
      reply += `  └ Canto Blanco: ${cartTotals.totalCantoWhiteMeters.toFixed(1)}m (${cartTotals.totalCantoWhiteRolls} rollo/s)\n`;
    }
    if (cartTotals.totalCantoColorMeters > 0) {
      reply += `  └ Canto Color: ${cartTotals.totalCantoColorMeters.toFixed(1)}m (${cartTotals.totalCantoColorRolls} rollo/s)\n`;
    }

    reply += `\n---\n`;
    reply += `💰 *Costo Total Herrajes:* ${formatter.format(cartTotals.totalHardwareCost)}\n`;
    reply += `💰 *Costo Total Tapacantos:* ${formatter.format(cartTotals.totalCantoCost)}\n`;
    reply += `💰 *Costo Total Placas:* ${formatter.format(mat.totalMaterialCost)}\n`;
    reply += `🚀 *GRAN TOTAL ACUMULADO:* ${formatter.format(cartTotals.grandTotal)}\n\n`;
  }

  reply += `_Comandos: /limpiar para vaciar el carrito._`;

  return reply;
}

// ── Lógica de Registro e Invitaciones ─────────────────────────────────────────
// ── Administración de Precios ────────────────────────────────────────────────

const CATEGORIES: Record<string, { label: string, keys: string[] }> = {
  placas: { label: "📁 Placas", keys: ["board_18mm_white", "board_18mm_color", "board_15mm_white", "board_3mm"] },
  cantos: { label: "🎞 Tapacantos", keys: ["canto_roll_white", "canto_roll_color"] },
  herrajes: { label: "⚙️ Herrajes", keys: ["hw_hinge_std", "hw_hinge_pre", "hw_hinge_lux", "hw_slide_std", "hw_slide_pre", "hw_slide_lux", "hw_sliding_std", "hw_sliding_pre", "hw_sliding_lux"] }
};

const KEY_LABELS: Record<string, string> = {
  board_18mm_white: "MDF 18mm Blanco",
  board_18mm_color: "MDF 18mm Color",
  board_15mm_white: "MDF 15mm Blanco",
  board_3mm: "MDF 3mm Fondo",
  canto_roll_white: "Rollo Blanco 50m",
  canto_roll_color: "Rollo Color 50m",
  hw_hinge_std: "Bisagras Std (x4)",
  hw_hinge_pre: "Bisagras Pre (x4)",
  hw_hinge_lux: "Bisagras Lux (x4)",
  hw_slide_std: "Guías Económicas (Par)",
  hw_slide_pre: "Guías Telesc. (Par)",
  hw_slide_lux: "Guías Ocultas (Par)",
  hw_sliding_std: "Kit Placard Econ.",
  hw_sliding_pre: "Kit Placard Alum.",
  hw_sliding_lux: "Kit Placard Luxury"
};

async function handleInviteRegistration(ctx: MyContext, code: string) {
  // Sanitizar: solo alfanumérico y guiones bajos, máx 32 chars
  const safeCode = code.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32);
  if (!safeCode) {
    log.warn("INVITE", `Código inválido recibido de ${ctx.from?.id}`, { code });
    return ctx.reply("❌ Código de invitación inválido.");
  }

  try {
    // 1. Verificar si ya está registrado para no duplicar
    const alreadyAllowed = await isUserAllowed(ctx.from!.id);
    if (alreadyAllowed) {
      log.info("INVITE", `Usuario ${ctx.from!.id} ya registrado, acceso concedido`);
      return ctx.reply("✅ Ya tenés acceso al bot. ¡Podés empezar a usarlo!");
    }

    // 2. Intentar registro
    const registeredName = await registerUser({
      telegramId: ctx.from!.id,
      name: ctx.from!.first_name,
      username: ctx.from!.username,
      code: safeCode
    });

    log.info("AUTH", `Nuevo usuario registrado: ${ctx.from!.id} (${ctx.from!.first_name}) con código: ${safeCode}`);
    
    // Notificar al Admin
    const archChannel = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
    if (archChannel) {
      await ctx.api.sendMessage(archChannel, `📢 *Nuevo Usuario:* ${registeredName}\n🆔 ID: ${ctx.from!.id}\n🎟 Código: ${safeCode}`, { parse_mode: "Markdown" }).catch(console.error);
    }

    // Onboarding de bienvenida profesional
    await sendWelcomeTutorial(ctx);
  } catch (error: any) {
    // NUNCA exponer detalles internos al usuario — solo loggear
    log.error("INVITE", `Error registrando usuario ${ctx.from?.id}`, error);
    await ctx.reply("❌ No se pudo completar el registro. Intentá de nuevo o contactá al administrador.");
  }
}

// ── Lógica de Archivo ─────────────────────────────────────────────────────────

async function executeArchive(ctx: MyContext, clientName: string) {
  if (ctx.session.modules.length === 0) return;

  const quoteId = `COT-${Math.floor(Math.random() * 90000) + 10000}`;
  const dateStr = new Date().toLocaleDateString('es-AR');
  const cartTotals = calculateCartTotals(ctx.session.modules);
  const baseSummary = formatProjectReply(ctx.session, null);

  const officialReceipt = `🧾 *REMITO OFICIAL: ${quoteId}*\n👤 *CLIENTE:* ${clientName}\n📅 *FECHA:* ${dateStr}\n\n${baseSummary}`;

  try {
    // 1. Guardar en Supabase
    await saveQuote({
      quoteId,
      telegramId: ctx.from!.id,
      clientName,
      modules: ctx.session.modules,
      totals: cartTotals,
      config: {
        front: ctx.session.defaultFrontMaterial,
        thickness: ctx.session.defaultInternalThickness,
        hardware: ctx.session.defaultHardwareTier
      }
    });

    // 2. Mirror opcional al canal si está configurado
    const archiveChannelId = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
    if (archiveChannelId) {
      await ctx.api.sendMessage(archiveChannelId, officialReceipt, { parse_mode: "Markdown" }).catch(console.error);
    }

    // 3. Responder al usuario con el remito
    await ctx.reply(officialReceipt, { parse_mode: "Markdown" });
    await ctx.reply(`✅ *¡Presupuesto ${quoteId} guardado con éxito!*\n\nTu carrito sigue lleno. Podés seguir agregando o usar /limpiar.`);
  } catch (error) {
    console.error("Error guardando presupuesto:", error);
    await ctx.reply("⚠️ Hubo un error al guardar el presupuesto en la base de datos.");
  }
}

// ── Handlers de Comandos ──────────────────────────────────────────────────────

bot.command("start", async (ctx) => {
  const payload = ctx.match;
  console.log(`[START] Payload recibido: "${payload}" de usuario ${ctx.from?.id}`);

  // Si viene con un payload de invitación (INV_...)
  if (payload && payload.startsWith("INV_")) {
    await handleInviteRegistration(ctx, payload);
    return;
  }

  // Reset normal de sesión
  ctx.session.modules = [];
  ctx.session.defaultFrontMaterial = "blanco";
  ctx.session.defaultHardwareTier = "premium";
  ctx.session.defaultInternalThickness = "15mm";
  ctx.reply("¡Hola! Soy tu bot de presupuestos de muebles. Mandame un audio o texto para cotizar, o usá /config para cambiar las opciones del proyecto.");
  const userId = ctx.from!.id;
  const isAllowed = await isUserAllowed(userId);

  if (isAllowed || userId === adminId) {
    return sendWelcomeTutorial(ctx);
  }

  await ctx.reply("👋 ¡Hola! Soy el asistente de presupuestos pro.\n\n" +
    "Para empezar a usarme, por favor ingresá tu código de invitación con el comando:\n" +
    "`/activar CODIGO` (ejemplo: `/activar MUEBLES2024`)", { parse_mode: "Markdown" });
});

bot.command("activar", async (ctx) => {
  const code = ctx.match;
  if (!code) return ctx.reply("Uso: /activar TU_CODIGO");
  await handleInviteRegistration(ctx, code);
});

bot.command("config", (ctx) => {
  ctx.reply("⚙️ *Configuración del Proyecto*\n\nAjustá los defaults de este cliente:", {
    parse_mode: "Markdown",
    reply_markup: buildConfigKeyboard(ctx.session)
  });
});

bot.command("limpiar", (ctx) => {
  ctx.session.modules = [];
  ctx.reply("🗑️ Carrito vacío. Podés arrancar un presupuesto desde cero.");
});

bot.command("resumen", (ctx) => {
  const keyboard = new InlineKeyboard();
  ctx.session.modules.forEach((mod, idx) => {
    keyboard.text(`✖️ Borrar #${idx + 1}`, `delete_${mod.id}`);
    if ((idx + 1) % 3 === 0) keyboard.row();
  });
  ctx.reply(formatProjectReply(ctx.session, null), { 
    parse_mode: "Markdown",
    reply_markup: ctx.session.modules.length > 0 ? keyboard : undefined
  });
});

bot.command("guardar", async (ctx) => {
  if (ctx.session.modules.length === 0) {
    return ctx.reply("❌ Tu carrito está vacío. No hay nada para guardar.");
  }

  const raw = ctx.match || "";
  // Sanitizar nombre del cliente: solo texto legible, máx 80 chars
  const clientName = raw.trim().slice(0, 80).replace(/[<>{}]/g, "");

  if (!clientName) {
    ctx.session.awaitingClientName = true;
    return ctx.reply("✏️ ¿A nombre de quién guardo este presupuesto? Escribime el nombre a continuación:");
  }

  await executeArchive(ctx, clientName);
});

bot.command("historial", async (ctx) => {
  try {
    const quotes = await getQuotesByUser(ctx.from!.id);
    if (quotes.length === 0) {
      return ctx.reply("Aún no tenés presupuestos guardados.");
    }

    const keyboard = new InlineKeyboard();
    quotes.forEach((q) => {
      const date = new Date(q.created_at).toLocaleDateString('es-AR');
      keyboard.text(`🧾 ${q.quote_id} · ${q.client_name} · ${date}`, `quote_${q.quote_id}`).row();
    });

    await ctx.reply("📋 *Tus últimos presupuestos:*\n\nTocá uno para ver el detalle 👇", {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
  } catch (error) {
    await ctx.reply("Error al consultar el historial.");
  }
});


/**
 * Onboarding para nuevos usuarios y comando /ayuda
 */
async function sendWelcomeTutorial(ctx: MyContext) {
  const name = ctx.from?.first_name || "Colega";
  
  await ctx.reply(`👋 ¡Hola ${name}! Bienvenido al asistente pro de carpintería.\n\n` +
    `Soy tu bot de presupuestos. Me podés hablar como a un compañero: mandame **TEXTO** o **AUDIOS** con lo que necesitás.`);

  await ctx.reply(`📚 **¿Cómo pedir un presupuesto?**\n\n` +
    `Podés decir algo bien natural, como:\n` +
    `• *"Cotizame un bajo mesada de un metro veinte por ochenta"* 📏\n` +
    `• *"Necesito una alacena de sesenta por sesenta con dos estantes"* 🏗️\n` +
    `• *"Haceme un placard de dos metros cuarenta por dos veinte y sesenta de fondo"* 👕\n\n` +
    `**Pro-Tip**: ¡No hace falta que digas "punto", decilo como se lo dirías a un cliente!`);

  await ctx.reply(`⚙️ **Comandos útiles:**\n` +
    `/historial - Ver tus presupuestos anteriores.\n` +
    `/config - Cambiar materiales por defecto.\n` +
    `/ayuda - Ver este tutorial de nuevo.`);
}

bot.command("ayuda", async (ctx) => {
  await sendWelcomeTutorial(ctx);
});

// ── Comandos de Admin ─────────────────────────────────────────────────────────

bot.command("admin_usuarios", async (ctx) => {
  if (ctx.from?.id !== adminId) return;
  
  try {
    const { data: users, error } = await supabase
      .from("allowed_users")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) {
      console.error("[ADMIN_USUARIOS ERROR]", error);
      return ctx.reply("⚠️ Error consultando la base de datos.");
    }

    if (!users || users.length === 0) {
      return ctx.reply("No hay usuarios registrados aún.");
    }

    let reply = "👤 *Usuarios Registrados:*\n\n";
    users.forEach((u: any, i: number) => {
      const date = new Date(u.created_at).toLocaleDateString("es-AR");
      reply += `${i + 1}. *${u.name || 'Sin nombre'}* (@${u.username || "sin_user"}) | ID: \`${u.telegram_id}\` | ${date}\n`;
    });
    
    await ctx.reply(reply, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("[ADMIN_USUARIOS CATCH]", error);
    await ctx.reply("⚠️ Error listando usuarios. Revisá los logs.");
  }
});

bot.command("admin_invitar", async (ctx) => {
  if (ctx.from?.id !== adminId) return;
  
  const maxUses = parseInt(ctx.match || "10", 10);
  const code = `INV_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  
  try {
    await createInvitation({ code, maxUses, createdBy: adminId });
    
    // Usar ctx.me.username que ya está cargado en el bot iniciado
    const botUsername = ctx.me.username;
    const link = `https://t.me/${botUsername}?start=${code}`;
    
    console.log(`[ADMIN] Invitación creada: ${code}. Link: ${link}`);
    
    await ctx.reply(`🆕 *Invitación Generada*\n\n🔗 Link: ${link}\n🔑 Código: \`${code}\`\n👥 Usos: ${maxUses}`, { parse_mode: "Markdown" });
  } catch (error) {
    await ctx.reply("Error creando invitación.");
  }
});

bot.command("admin_stats", async (ctx) => {
  if (ctx.from?.id !== adminId) return;

  try {
    const waitMsg = await ctx.reply("🔄 Calculando estadísticas...");
    const stats = await getStats();

    const formatter = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
    const topModuleLabel = stats.topModule.replace('_', ' ').toUpperCase();
    const activeUserStr = stats.mostActiveUser
      ? `${stats.mostActiveUser.name} _(${stats.mostActiveUser.count} presupuesto${stats.mostActiveUser.count !== 1 ? 's' : ''})_`
      : 'Sin datos aún';
    const reply = [
      `📊 *ESTADÍSTICAS DEL BOT*`,
      ``,
      `👥 *Usuarios registrados:* ${stats.totalUsers}`,
      ``,
      `📋 *Presupuestos generados:* ${stats.totalQuotes}`,
      `  └ Hoy: ${stats.quotesToday}`,
      `  └ Esta semana: ${stats.quotesThisWeek}`,
      ``,
      `💰 *Ticket promedio:* ${stats.avgTicket > 0 ? formatter.format(stats.avgTicket) : 'Sin datos'}`,
      ``,
      `🔥 *Módulo más cotizado:* ${topModuleLabel}`,
      ``,
      `⭐ *Usuario más activo:* ${activeUserStr}`,
    ].join('\n');

    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, reply, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("[STATS ERROR]", error);
    await ctx.reply("⚠️ Error al calcular estadísticas.");
  }
});

// ── Handlers de Mensajes y Callbacks ──────────────────────────────────────────

bot.on("message:text", async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;

  if (ctx.session.awaitingClientName) {
    ctx.session.awaitingClientName = false;
    const name = ctx.message.text.trim().slice(0, 80).replace(/[<>{}]/g, "");
    await executeArchive(ctx, name);
    return;
  }

  // Rate limit: proteger el free tier de Groq
  if (isRateLimited(ctx.from!.id)) {
    log.warn("RATE", `Usuario ${ctx.from!.id} (${ctx.from!.username}) excedió el límite de solicitudes`);
    return ctx.reply("⏳ Esperá un momento antes de enviar otro mensaje. Máximo 10 solicitudes por minuto.");
  }

  try {
    const waitMsg = await ctx.reply("🤔 Analizando...");
    log.info("NLU", `Procesando texto de ${ctx.from!.id}`);
    const quoteRequestsArrayRaw = await parseTextToQuote(ctx.message.text, "");
    
    // Validación robusta: filtrar solo módulos válidos según el esquema
    const quoteRequestsArray = quoteRequestsArrayRaw
      .map(q => {
        const result = QuoteRequestSchema.safeParse(q);
        if (!result.success) {
          log.warn("NLU_VALIDATION", `Módulo descartado por datos corruptos: ${JSON.stringify(result.error.format())}`);
          return null;
        }
        return result.data;
      })
      .filter((q): q is any => q !== null);

    if (quoteRequestsArray.length === 0) {
      log.warn("NLU", "No se encontraron módulos válidos en el texto");
      
      // Notificar al Admin
      const arch = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
      if (arch) {
        await ctx.api.sendMessage(arch, `⚠️ *NLU Falló (Texto):* No se detectaron módulos.\n👤 Usuario: ${ctx.from?.first_name} (@${ctx.from?.username})\n💬 Texto: "${ctx.message.text}"`, { parse_mode: "Markdown" }).catch(console.error);
      }

      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, "⚠️ No detecté ningún módulo claro. ¿Podés intentar de nuevo con medidas?");
      return;
    }

    const quoteResults = await Promise.all(quoteRequestsArray.map(q => calculateQuote({
      ...q,
      frontMaterial: q.frontMaterial || ctx.session.defaultFrontMaterial,
      hardwareTier: q.hardwareTier || ctx.session.defaultHardwareTier,
      internalThickness: q.internalThickness || ctx.session.defaultInternalThickness,
    })));
    ctx.session.modules.push(...quoteResults);
    log.info("QUOTE", `${quoteResults.length} módulo(s) agregados para ${ctx.from!.id}`);

    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, formatProjectReply(ctx.session, quoteResults), {
      parse_mode: "Markdown",
      reply_markup: buildCartKeyboard(ctx.session)
    });
  } catch (error) {
    log.error("NLU", `Error procesando texto de ${ctx.from?.id}`, error);
    
    // Notificar al Admin sobre error crítico
    const arch = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
    if (arch) {
      await ctx.api.sendMessage(arch, `❌ *Error NLU (Texto):* ${error instanceof Error ? error.message : 'Error desconocido'}\n👤 Usuario: ${ctx.from?.first_name} (@${ctx.from?.username})`, { parse_mode: "Markdown" }).catch(console.error);
    }
    
    await ctx.reply("⚠️ No pude procesar ese mensaje. Intentá de nuevo.");
  }
});

bot.on("message:voice", async (ctx) => {
  // Rate limit: proteger el free tier de Groq
  if (isRateLimited(ctx.from!.id)) {
    log.warn("RATE", `Usuario ${ctx.from!.id} excedió el límite (audio)`);
    return ctx.reply("⏳ Esperá un momento antes de enviar otro audio. Máximo 10 solicitudes por minuto.");
  }

  try {
    const waitMsg = await ctx.reply("🤔 Escuchando...");
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${telegramToken}/${file.file_path}`;
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());

    log.info("NLU", `Procesando audio de ${ctx.from!.id} (tamaño: ${buffer.length} bytes)`);
    const quoteRequestsArrayRaw = await parseAudioToQuote(buffer, "audio/ogg", "");
    
    // Validación de esquema
    const quoteRequestsArray = quoteRequestsArrayRaw
      .map(q => {
        const result = QuoteRequestSchema.safeParse(q);
        if (!result.success) return null;
        return result.data;
      })
      .filter((q): q is any => q !== null);

    if (quoteRequestsArray.length === 0) {
      log.warn("NLU", "No se encontraron módulos válidos en el audio");

      // Notificar al Admin
      const arch = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
      if (arch) {
        await ctx.api.sendMessage(arch, `⚠️ *NLU Falló (Audio):* No se detectaron módulos.\n👤 Usuario: ${ctx.from?.first_name} (@${ctx.from?.username})`, { parse_mode: "Markdown" }).catch(console.error);
      }

      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, "⚠️ No detecté módulos en el audio. Intentá de nuevo.");
      return;
    }

    const quoteResults = await Promise.all(quoteRequestsArray.map(q => calculateQuote({
      ...q,
      frontMaterial: q.frontMaterial || ctx.session.defaultFrontMaterial,
      hardwareTier: q.hardwareTier || ctx.session.defaultHardwareTier,
      internalThickness: q.internalThickness || ctx.session.defaultInternalThickness,
    })));
    ctx.session.modules.push(...quoteResults);
    log.info("QUOTE", `${quoteResults.length} módulo(s) agregados para ${ctx.from!.id}`);

    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, formatProjectReply(ctx.session, quoteResults), {
      parse_mode: "Markdown",
      reply_markup: buildCartKeyboard(ctx.session)
    });
  } catch (error) {
    log.error("VOICE", `Error procesando audio de ${ctx.from?.id}`, error);

    // Notificar al Admin
    const arch = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
    if (arch) {
      await ctx.api.sendMessage(arch, `❌ *Error Grave (Audio):* ${error instanceof Error ? error.message : 'Error desconocido'}\n👤 Usuario: ${ctx.from?.first_name} (@${ctx.from?.username})`, { parse_mode: "Markdown" }).catch(console.error);
    }

    await ctx.reply("⚠️ No pude procesar el audio. Intentá de nuevo.");
  }
});

function buildCartKeyboard(session: SessionData): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  session.modules.forEach((mod, idx) => {
    keyboard.text(`✖️ Borrar #${idx + 1}`, `delete_${mod.id}`);
    if ((idx + 1) % 3 === 0) keyboard.row();
  });
  return keyboard;
}

function buildConfigKeyboard(session: SessionData): InlineKeyboard {
  const front = session.defaultFrontMaterial || "blanco";
  const thickness = session.defaultInternalThickness || "18mm";
  const tier = session.defaultHardwareTier || "premium";
  const tierLabel = tier === 'standard' ? '💰 Económico' : tier === 'luxury' ? '💎 Luxury' : '⭐ Premium';
  return new InlineKeyboard()
    .text(`🎨 Frentes: ${front.toUpperCase()} 🔄`, "toggle_front_material").row()
    .text(`📐 Interior: ${thickness} 🔄`, "toggle_internal_thickness").row()
    .text(`🔩 Herrajes: ${tierLabel}`, "cycle_hardware_tier");
}

bot.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;

  if (data === "toggle_front_material") {
    ctx.session.defaultFrontMaterial = ctx.session.defaultFrontMaterial === "blanco" ? "color" : "blanco";
    await ctx.editMessageReplyMarkup({ reply_markup: buildConfigKeyboard(ctx.session) });
    return ctx.answerCallbackQuery(`Frentes → ${ctx.session.defaultFrontMaterial.toUpperCase()}`);
  }
  if (data === "toggle_internal_thickness") {
    ctx.session.defaultInternalThickness = ctx.session.defaultInternalThickness === "18mm" ? "15mm" : "18mm";
    await ctx.editMessageReplyMarkup({ reply_markup: buildConfigKeyboard(ctx.session) });
    return ctx.answerCallbackQuery(`Interior → ${ctx.session.defaultInternalThickness}`);
  }
  if (data === "cycle_hardware_tier") {
    const order: ("standard" | "premium" | "luxury")[] = ["standard", "premium", "luxury"];
    ctx.session.defaultHardwareTier = order[(order.indexOf(ctx.session.defaultHardwareTier || "premium") + 1) % order.length];
    await ctx.editMessageReplyMarkup({ reply_markup: buildConfigKeyboard(ctx.session) });
    return ctx.answerCallbackQuery(`Herrajes → ${ctx.session.defaultHardwareTier}`);
  }

  if (data.startsWith("delete_")) {
    const id = data.replace("delete_", "");
    const index = ctx.session.modules.findIndex(m => m.id === id);
    if (index !== -1) {
      ctx.session.modules.splice(index, 1);
      await ctx.editMessageText(formatProjectReply(ctx.session, null), {
        parse_mode: "Markdown",
        reply_markup: buildCartKeyboard(ctx.session)
      });
      return ctx.answerCallbackQuery("Módulo eliminado.");
    }
  }

  // ── Ver detalle de presupuesto del historial ─────────────────────────────────
  if (data.startsWith("quote_")) {
    const quoteId = data.replace("quote_", "");
    await ctx.answerCallbackQuery();
    try {
      const q = await getQuoteById(quoteId);
      if (!q || q.telegram_id !== ctx.from!.id) {
        return ctx.reply("❌ No se encontró ese presupuesto.");
      }
      const mockSession: SessionData = { modules: q.modules };
      const date = new Date(q.created_at).toLocaleDateString('es-AR');
      return ctx.reply(
        `🧾 *REMITO: ${q.quote_id}*\n👤 Cliente: ${q.client_name}\n📅 Fecha: ${date}\n\n${formatProjectReply(mockSession, null)}`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      return ctx.reply("⚠️ Error al cargar el presupuesto.");
    }
  }

  return next();
});

// ── Administración de Precios (Interactivo) ───────────────────────────────────

bot.command("admin_precios", async (ctx) => {
  if (ctx.from?.id !== adminId) return;
  
  const keyboard = new InlineKeyboard();
  Object.entries(CATEGORIES).forEach(([id, cat]) => {
    keyboard.text(cat.label, `admin_cat_${id}`).row();
  });

  await ctx.reply("💰 *Gestión de Precios*\nElegí una categoría para editar:", {
    parse_mode: "Markdown",
    reply_markup: keyboard
  });
});

bot.callbackQuery(/^admin_cat_(.+)$/, async (ctx) => {
  const catId = ctx.match[1];
  const cat = CATEGORIES[catId];
  if (!cat) return;

  const keyboard = new InlineKeyboard();
  cat.keys.forEach(key => {
    keyboard.text(`✏️ ${KEY_LABELS[key] || key}`, `admin_edit_${key}`).row();
  });
  keyboard.text("🔙 Volver", "admin_precios_root");

  await ctx.editMessageText(`📂 *Categoría: ${cat.label}*\nElegí el ítem a modificar:`, {
    parse_mode: "Markdown",
    reply_markup: keyboard
  });
});

bot.callbackQuery("admin_precios_root", async (ctx) => {
  const keyboard = new InlineKeyboard();
  Object.entries(CATEGORIES).forEach(([id, cat]) => {
    keyboard.text(cat.label, `admin_cat_${id}`).row();
  });
  await ctx.editMessageText("💰 *Gestión de Precios*\nElegí una categoría para editar:", {
    parse_mode: "Markdown",
    reply_markup: keyboard
  });
});

bot.callbackQuery(/^admin_edit_(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  ctx.session.awaitingPriceKey = key;
  
  await ctx.editMessageText(`✍️ *Editando: ${KEY_LABELS[key] || key}*\n\nIngresá el nuevo valor numérico (solo el número, ej: 12500):`, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().text("❌ Cancelar", "admin_precios_root")
  });
});

// Middleware para capturar el nuevo valor del precio
bot.on("message:text", async (ctx, next) => {
  if (ctx.session.awaitingPriceKey && ctx.from?.id === adminId) {
    const val = parseFloat(ctx.message.text.replace(/[^0-9.]/g, ""));
    if (isNaN(val)) {
      return ctx.reply("❌ Valor inválido. Mandame solo el número.");
    }

    const key = ctx.session.awaitingPriceKey;
    try {
      await updateBotSetting(key, val);
      await refreshPrices(); // Sincronizar cache local
      
      const label = KEY_LABELS[key] || key;
      ctx.session.awaitingPriceKey = undefined;
      
      await ctx.reply(`✅ *¡Precio actualizado!*\n\n*${label}* ahora cuesta: $${val.toLocaleString('es-AR')}`);
      
      // Notificar al canal de auditoría
      const arch = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
      if (arch) {
        await ctx.api.sendMessage(arch, `⚒ *Cambio de Precio:* ${label}\n💰 Nuevo Valor: $${val}\n👤 Admin: ${ctx.from.first_name}`).catch(console.error);
      }
    } catch (e) {
      log.error("ADMIN", "Error al guardar precio", e);
      await ctx.reply("❌ Error al guardar en la base de datos.");
    }
    return;
  }
  await next();
});

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

  // 1. Configurar Menú — Comandos para TODO el mundo (en chats privados)
  await bot.api.setMyCommands([
    { command: "start", description: "Reiniciar carrito" },
    { command: "config", description: "Cambiar calidades" },
    { command: "resumen", description: "Ver total acumulado" },
    { command: "limpiar", description: "Vaciar carrito" },
    { command: "guardar", description: "Archivar presupuesto" },
    { command: "historial", description: "Ver presupuestos guardados" }
  ], { scope: { type: "all_private_chats" } });

  // 2. Comandos extra — Visibles SÓLO para el admin (en su chat específico)
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

  // 0. Inicializar Precios
  await refreshPrices();

  console.log("¡Bot iniciado con éxito!");

  // Error Handler
  bot.catch((err) => {
    console.error(`[Global Error] ❌ Error en update ${err.ctx.update.update_id}:`, err.error);
  });

  await bot.start();
}

main().catch(console.error);

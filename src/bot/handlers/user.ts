import { Composer } from "grammy";
import { MyContext } from "../types";
import { isUserAllowed, registerUser, saveQuote, getQuotesByUser, getQuoteById } from "../../db/supabase";
import { parseTextToQuote, parseAudioToQuote } from "../../nlu/parser";
import { fillDefaults } from "../../nlu/providers/shared";
import { calculateQuote, calculateCartTotals } from "../../engine/pricing";
import { QuoteResult, QuoteRequestSchema, QuoteRequest } from "../../engine/types";
import { buildCartKeyboard, buildConfigKeyboard } from "../utils/keyboards";
import { formatProjectReply, formatValidationErrors } from "../utils/formatters";
import { log } from "../utils/logger";

const adminId = parseInt(process.env.ADMIN_TELEGRAM_ID || "0", 10);

export const userRouter = new Composer<MyContext>();

const MAX_REQUESTS = 10;
const WINDOW_MS = 60_000;
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

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

async function handleInviteRegistration(ctx: MyContext, code: string) {
  const safeCode = code.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32);
  if (!safeCode) {
    log.warn("INVITE", `Código inválido recibido de ${ctx.from?.id}`, { code });
    return ctx.reply("❌ Código de invitación inválido.");
  }

  try {
    const alreadyAllowed = await isUserAllowed(ctx.from!.id);
    if (alreadyAllowed) {
      log.info("INVITE", `Usuario ${ctx.from!.id} ya registrado, acceso concedido`);
      return ctx.reply("✅ Ya tenés acceso al bot. ¡Podés empezar a usarlo!");
    }

    const registeredName = await registerUser({
      telegramId: ctx.from!.id,
      name: ctx.from!.first_name,
      username: ctx.from!.username,
      code: safeCode
    });

    log.info("AUTH", `Nuevo usuario registrado: ${ctx.from!.id} (${ctx.from!.first_name}) con código: ${safeCode}`);
    
    const archChannel = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
    if (archChannel) {
      await ctx.api.sendMessage(archChannel, `📢 *Nuevo Usuario:* ${registeredName}\n🆔 ID: ${ctx.from!.id}\n🎟 Código: ${safeCode}`, { parse_mode: "Markdown" }).catch(console.error);
    }

    await sendWelcomeTutorial(ctx);
  } catch (error: any) {
    log.error("INVITE", `Error registrando usuario ${ctx.from?.id}`, error);
    await ctx.reply("❌ No se pudo completar el registro. Intentá de nuevo o contactá al administrador.");
  }
}

async function executeArchive(ctx: MyContext, clientName: string) {
  if (ctx.session.modules.length === 0) return;

  const quoteId = `COT-${Math.floor(Math.random() * 90000) + 10000}`;
  const dateStr = new Date().toLocaleDateString('es-AR');
  const cartTotals = calculateCartTotals(ctx.session.modules);
  const baseSummary = formatProjectReply(ctx.session, null);

  const officialReceipt = `🧾 *REMITO OFICIAL: ${quoteId}*\n👤 *CLIENTE:* ${clientName}\n📅 *FECHA:* ${dateStr}\n\n${baseSummary}`;

  try {
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

    const archiveChannelId = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
    if (archiveChannelId) {
      await ctx.api.sendMessage(archiveChannelId, officialReceipt, { parse_mode: "Markdown" }).catch(console.error);
    }

    await ctx.reply(officialReceipt, { parse_mode: "Markdown" });
    await ctx.reply(`✅ *¡Presupuesto ${quoteId} guardado con éxito!*\n\nTu carrito sigue lleno. Podés seguir agregando o usar /limpiar.`);
  } catch (error) {
    log.error("ARCHIVE", "Error guardando presupuesto", error);
    await ctx.reply("⚠️ Hubo un error al guardar el presupuesto en la base de datos.");
  }
}

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

userRouter.command("start", async (ctx) => {
  const payload = ctx.match;
  log.info("START", `Payload recibido: "${payload}" de usuario ${ctx.from?.id}`);

  if (payload && payload.startsWith("INV_")) {
    await handleInviteRegistration(ctx, payload);
    return;
  }

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

userRouter.command("activar", async (ctx) => {
  const code = ctx.match;
  if (!code) return ctx.reply("Uso: /activar TU_CODIGO");
  await handleInviteRegistration(ctx, code);
});

userRouter.command("config", (ctx) => {
  ctx.reply("⚙️ *Configuración del Proyecto*\n\nAjustá los defaults de este cliente:", {
    parse_mode: "Markdown",
    reply_markup: buildConfigKeyboard(ctx.session)
  });
});

userRouter.command("limpiar", (ctx) => {
  ctx.session.modules = [];
  ctx.reply("🗑️ Carrito vacío. Podés arrancar un presupuesto desde cero.");
});

userRouter.command("resumen", (ctx) => {
  ctx.reply(formatProjectReply(ctx.session, null), { 
    parse_mode: "Markdown",
    reply_markup: ctx.session.modules.length > 0 ? buildCartKeyboard(ctx.session) : undefined
  });
});

userRouter.command("guardar", async (ctx) => {
  if (ctx.session.modules.length === 0) {
    return ctx.reply("❌ Tu carrito está vacío. No hay nada para guardar.");
  }

  const raw = ctx.match || "";
  const clientName = raw.trim().slice(0, 80).replace(/[<>{}]/g, "");

  if (!clientName) {
    ctx.session.awaitingClientName = true;
    return ctx.reply("✏️ ¿A nombre de quién guardo este presupuesto? Escribime el nombre a continuación:");
  }

  await executeArchive(ctx, clientName);
});

userRouter.command("historial", async (ctx) => {
  try {
    const quotes = await getQuotesByUser(ctx.from!.id);
    if (quotes.length === 0) {
      return ctx.reply("Aún no tenés presupuestos guardados.");
    }

    const { InlineKeyboard } = await import("grammy");
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

userRouter.command("ayuda", async (ctx) => {
  await sendWelcomeTutorial(ctx);
});

userRouter.on("message:text", async (ctx, next) => {
  if (ctx.session.awaitingPriceKey) return next();
  if (ctx.message.text.startsWith('/')) return;

  if (ctx.session.awaitingClientName) {
    ctx.session.awaitingClientName = false;
    const name = ctx.message.text.trim().slice(0, 80).replace(/[<>{}]/g, "");
    await executeArchive(ctx, name);
    return;
  }

  if (isRateLimited(ctx.from!.id)) {
    log.warn("RATE", `Usuario ${ctx.from!.id} excedió límite de peticiones textuales`);
    return ctx.reply("⏳ Esperá un momento. Máximo 10 solicitudes por minuto.");
  }

  try {
    const waitMsg = await ctx.reply("🤔 Analizando...");
    log.info("NLU", `Procesando texto de ${ctx.from!.id}`);
    const quoteRequestsArrayRaw = await parseTextToQuote(ctx.message.text, "");
    
    const quoteRequestsArray: QuoteRequest[] = [];
    const failedModules: string[] = [];

    quoteRequestsArrayRaw.forEach(q => {
      const qWithDefaults = fillDefaults(q);
      const result = QuoteRequestSchema.safeParse(qWithDefaults);
      if (!result.success) {
        log.warn("NLU_VALIDATION", `Módulo descartado: ${JSON.stringify(result.error.format())}`);
        failedModules.push(formatValidationErrors(q, result.error as any));
      } else {
        quoteRequestsArray.push(result.data);
      }
    });

    if (quoteRequestsArray.length === 0) {
      log.warn("NLU", "No módulos en texto");
      const arch = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
      if (arch) {
        await ctx.api.sendMessage(arch, `⚠️ *NLU Falló (Texto)*\n👤 Usuario: ${ctx.from?.first_name}\n💬 Texto: "${ctx.message.text}"`, { parse_mode: "Markdown" }).catch(console.error);
      }

      const errorStr = failedModules.length > 0 
        ? `⚠️ Encontré módulos pero faltan datos:\n${failedModules.join("\n")}\n\n¿Podés reintentar?`
        : "⚠️ No detecté ningún módulo claro. ¿Podés intentar de nuevo?";

      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, errorStr, { parse_mode: "Markdown" });
      return;
    }

    const quoteResults = await Promise.all(quoteRequestsArray.map(q => calculateQuote({
      ...q,
      frontMaterial: q.frontMaterial || ctx.session.defaultFrontMaterial,
      hardwareTier: q.hardwareTier || ctx.session.defaultHardwareTier,
      internalThickness: q.internalThickness || ctx.session.defaultInternalThickness,
    })));
    ctx.session.modules.push(...quoteResults);
    
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, formatProjectReply(ctx.session, quoteResults, failedModules), {
      parse_mode: "Markdown",
      reply_markup: buildCartKeyboard(ctx.session)
    });
  } catch (error: any) {
    if (error.message === 'NLU_PARSE_ERROR') {
      return ctx.reply("⚠️ No logré entender el pedido. Decime claro el módulo y medidas.");
    }
    log.error("NLU", "Error", error);
    await ctx.reply("⚠️ No pude procesar ese mensaje.");
  }
});

userRouter.on("message:voice", async (ctx) => {
  if (isRateLimited(ctx.from!.id)) {
    return ctx.reply("⏳ Esperá un momento (límite de envíos).");
  }

  try {
    const waitMsg = await ctx.reply("🤔 Escuchando...");
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());

    log.info("NLU", `Procesando audio de ${ctx.from!.id}`);
    const quoteRequestsArrayRaw = await parseAudioToQuote(buffer, "audio/ogg", "");
    
    const quoteRequestsArray: QuoteRequest[] = [];
    const failedModules: string[] = [];

    quoteRequestsArrayRaw.forEach(q => {
      const qWithDefaults = fillDefaults(q);
      const result = QuoteRequestSchema.safeParse(qWithDefaults);
      if (!result.success) {
        failedModules.push(formatValidationErrors(q, result.error as any));
      } else {
        quoteRequestsArray.push(result.data);
      }
    });

    if (quoteRequestsArray.length === 0) {
      log.warn("NLU", "No módulos en audio");
      const arch = process.env.TELEGRAM_ARCHIVE_CHANNEL_ID;
      if (arch) {
        await ctx.api.sendMessage(arch, `⚠️ *NLU Falló (Audio)*\n👤 Usuario: ${ctx.from?.first_name}`, { parse_mode: "Markdown" }).catch(console.error);
      }

      const errorStr = failedModules.length > 0 
        ? `⚠️ Encontré módulos pero faltan datos:\n${failedModules.join("\n")}`
        : "⚠️ No detecté módulos en el audio.";

      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, errorStr, { parse_mode: "Markdown" });
      return;
    }

    const quoteResults = await Promise.all(quoteRequestsArray.map(q => calculateQuote({
      ...q,
      frontMaterial: q.frontMaterial || ctx.session.defaultFrontMaterial,
      hardwareTier: q.hardwareTier || ctx.session.defaultHardwareTier,
      internalThickness: q.internalThickness || ctx.session.defaultInternalThickness,
    })));
    ctx.session.modules.push(...quoteResults);
    
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, formatProjectReply(ctx.session, quoteResults, failedModules), {
      parse_mode: "Markdown",
      reply_markup: buildCartKeyboard(ctx.session)
    });
  } catch (error: any) {
    if (error.message === 'NLU_PARSE_ERROR') {
      return ctx.reply("⚠️ No logré entender el pedido del audio. Decime claro módulo y medidas.");
    }
    log.error("VOICE", "Error", error);
    await ctx.reply("⚠️ No pude procesar el audio.");
  }
});

userRouter.on("callback_query:data", async (ctx, next) => {
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
        reply_markup: ctx.session.modules.length > 0 ? buildCartKeyboard(ctx.session) : undefined
      });
      return ctx.answerCallbackQuery("Módulo eliminado.");
    }
  }

  if (data.startsWith("quote_")) {
    const quoteId = data.replace("quote_", "");
    await ctx.answerCallbackQuery();
    try {
      const q = await getQuoteById(quoteId);
      if (!q || q.telegram_id !== ctx.from!.id) {
        return ctx.reply("❌ No se encontró ese presupuesto.");
      }
      const date = new Date(q.created_at).toLocaleDateString('es-AR');
      return ctx.reply(
        `🧾 *REMITO: ${q.quote_id}*\n👤 Cliente: ${q.client_name}\n📅 Fecha: ${date}\n\n${formatProjectReply({ modules: q.modules } as any, null)}`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      return ctx.reply("⚠️ Error al cargar el presupuesto.");
    }
  }

  return next();
});

import { Composer } from "grammy";
import { z } from "zod";
import { MyContext } from "../types";
import { isUserAllowed, registerUser, saveQuote, getQuotesByUser, getQuoteById, updateTenantSettings } from "../../db/supabase";
import { calculateCartTotals } from "../../engine/pricing";
import { QuoteResult } from "../../engine/types";
import { processTextQuote, processAudioQuote } from "../services/nluProcessor";
import { buildCartKeyboard, buildConfigKeyboard, buildHistoryKeyboard, buildConfigMenuFrentes, buildConfigMenuHerrajes, buildConfigMenuInterior } from "../utils/keyboards";
import { formatProjectReply, formatValidationErrors } from "../utils/formatters";
import { log } from "../utils/logger";
import { executeArchive } from "../services/archive";

const adminId = parseInt(process.env.ADMIN_TELEGRAM_ID || "0", 10);

export const userRouter = new Composer<MyContext>();



async function handleInviteRegistration(ctx: MyContext, code: string) {
  const result = z.string().regex(/^[a-zA-Z0-9_]+$/).max(32).safeParse(code);
  if (!result.success) {
    log.warn("INVITE", `Código inválido recibido de ${ctx.from?.id}`, { code });
    return ctx.reply("❌ Código de invitación inválido.");
  }
  const safeCode = result.data;

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
  } catch (error: unknown) {
    log.error("INVITE", `Error registrando usuario ${ctx.from?.id}`, error);
    await ctx.reply("❌ No se pudo completar el registro. Intentá de nuevo o contactá al administrador.");
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
  if (!code) return ctx.reply("Che, pasame el código así: /activar TU_CODIGO");
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
  if (!raw.trim()) {
    ctx.session.awaitingClientName = true;
    return ctx.reply("✏️ ¿A nombre de quién guardo este presupuesto? Escribime el nombre a continuación:");
  }

  const schema = z.string().min(1).max(80).regex(/^[^<>{}]*$/);
  const result = schema.safeParse(raw.trim());

  if (!result.success) {
    return ctx.reply("❌ El nombre de cliente contiene caracteres inválidos.");
  }

  await executeArchive(ctx, result.data);
});

userRouter.command("historial", async (ctx) => {
  try {
    const quotes = await getQuotesByUser(ctx.from!.id);
    if (quotes.length === 0) {
      return ctx.reply("Aún no tenés presupuestos guardados.");
    }

    await ctx.reply("📋 *Tus últimos presupuestos:*\n\nTocá uno para ver el detalle 👇", {
      parse_mode: "Markdown",
      reply_markup: buildHistoryKeyboard(quotes)
    });
  } catch (error) {
    await ctx.reply("Error al consultar el historial.");
  }
});

userRouter.command("ayuda", async (ctx) => {
  await sendWelcomeTutorial(ctx);
});

userRouter.on("message", async (ctx, next) => {
  if (ctx.session.awaitingClientName) {
    if (!ctx.message.text) {
      return ctx.reply("⚠️ Estoy esperando un nombre de cliente válido. Por favor, escribilo con el teclado.");
    }
  }
  if (ctx.session.awaitingProfitMargin) {
    if (!ctx.message.text) {
      return ctx.reply("⚠️ Estoy esperando un número. Por favor, escribilo con el teclado.");
    }
  }
  return next();
});

userRouter.on("message:text", async (ctx, next) => {
  if (ctx.session.awaitingPriceKey) return next();
  if (ctx.message.text.startsWith('/')) return;

  if (ctx.session.awaitingClientName) {
    const schema = z.string().min(1).max(80).regex(/^[^<>{}]*$/);
    const result = schema.safeParse(ctx.message.text.trim());
    if (!result.success) {
      return ctx.reply("❌ El nombre de cliente contiene caracteres inválidos.");
    }
    
    ctx.session.awaitingClientName = false;
    await executeArchive(ctx, result.data);
    return;
  }

  if (ctx.session.awaitingProfitMargin) {
    const raw = ctx.message.text.trim().replace(/[^0-9]/g, "");
    if (!raw) {
      return ctx.reply("❌ Formato inválido. Pasame un número entero (ej: 40).");
    }
    
    const marginPercent = parseInt(raw, 10);
    const newMargin = 1 + (marginPercent / 100);
    
    if (!ctx.session.tenantSettings) {
      ctx.session.tenantSettings = { margin: newMargin, currency: "$" };
    } else {
      ctx.session.tenantSettings.margin = newMargin;
    }
    
    ctx.session.awaitingProfitMargin = false;
    
    await ctx.reply(`✅ Rentabilidad actualizada al +${marginPercent}%.\n(Guardado en tu perfil B2B).`);
    await updateTenantSettings(ctx.from!.id, ctx.session.tenantSettings).catch(e => {
      log.error("CONFIG", "Error guardando tenant settings", e instanceof Error ? e : new Error(String(e)));
    });
    
    return ctx.reply("⚙️ *Configuración del Proyecto actual:*", {
      parse_mode: "Markdown",
      reply_markup: buildConfigKeyboard(ctx.session)
    });
  }


  try {
    const waitMsg = await ctx.reply("🤔 Analizando...");
    const { validQuotes, errorMessages } = await processTextQuote(ctx.message.text, ctx.session);

    if (validQuotes.length === 0) {
      if (process.env.TELEGRAM_ARCHIVE_CHANNEL_ID) {
        await ctx.api.sendMessage(process.env.TELEGRAM_ARCHIVE_CHANNEL_ID, `⚠️ *NLU Falló (Texto)*\n👤 Usuario: ${ctx.from?.first_name}\n💬 Texto: "${ctx.message.text}"`, { parse_mode: "Markdown" }).catch(console.error);
      }
      const errorStr = errorMessages.length > 0 
        ? `⚠️ Encontré módulos pero faltan datos:\n${errorMessages.join("\n")}\n\n¿Podés reintentar?`
        : "⚠️ No detecté ningún módulo claro. ¿Podés intentar de nuevo?";
      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, errorStr, { parse_mode: "Markdown" });
      return;
    }

    ctx.session.modules = [...ctx.session.modules, ...validQuotes];
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, formatProjectReply(ctx.session, validQuotes, errorMessages), {
      parse_mode: "Markdown",
      reply_markup: buildCartKeyboard(ctx.session)
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'NLU_PARSE_ERROR') {
      return ctx.reply("⚠️ No logré entender el pedido. Decime claro el módulo y medidas.");
    }
    log.error("NLU", "Error procesando solicitud de texto", error instanceof Error ? error : new Error(String(error)));
    await ctx.reply("⚠️ No pude procesar ese mensaje.");
  }
});

userRouter.on("message:voice", async (ctx, next) => {
  if (ctx.session.awaitingPriceKey) return next();
  if (ctx.session.awaitingClientName) {
    return ctx.reply("⚠️ Estoy esperando un nombre de cliente. Por favor, escribilo por texto.");
  }


  try {
    const waitMsg = await ctx.reply("🤔 Escuchando...");
    const file = await ctx.getFile();
    const { validQuotes, errorMessages } = await processAudioQuote(process.env.TELEGRAM_BOT_TOKEN!, file.file_path!, ctx.session);

    if (validQuotes.length === 0) {
      if (process.env.TELEGRAM_ARCHIVE_CHANNEL_ID) {
        await ctx.api.sendMessage(process.env.TELEGRAM_ARCHIVE_CHANNEL_ID, `⚠️ *NLU Falló (Audio)*\n👤 Usuario: ${ctx.from?.first_name}`, { parse_mode: "Markdown" }).catch(console.error);
      }
      const errorStr = errorMessages.length > 0 
        ? `⚠️ Encontré módulos pero faltan datos:\n${errorMessages.join("\n")}`
        : "⚠️ No detecté módulos en el audio.";
      await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, errorStr, { parse_mode: "Markdown" });
      return;
    }

    ctx.session.modules = [...ctx.session.modules, ...validQuotes];
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, formatProjectReply(ctx.session, validQuotes, errorMessages), {
      parse_mode: "Markdown",
      reply_markup: buildCartKeyboard(ctx.session)
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'NLU_PARSE_ERROR') {
      return ctx.reply("⚠️ No logré entender el pedido del audio. Decime claro módulo y medidas.");
    }
    log.error("VOICE", "Error de NLU para audio", error instanceof Error ? error : new Error(String(error)));
    await ctx.reply("⚠️ No pude procesar el audio.");
  }
});

userRouter.on("callback_query:data", async (ctx, next) => {
  const data = ctx.callbackQuery.data;

  // Acciones Maestras del Carrito
  if (data === "action_guardar") {
    if (ctx.session.modules.length === 0) {
      return ctx.answerCallbackQuery({ text: "Tu carrito está vacío", show_alert: true });
    }
    ctx.session.awaitingClientName = true;
    await ctx.answerCallbackQuery();
    return ctx.reply("✏️ ¿A nombre de quién guardo este presupuesto? Escribime el nombre a continuación:");
  }

  if (data === "action_limpiar") {
    ctx.session.modules = [];
    await ctx.editMessageText("🗑️ Carrito vacío. Podés arrancar un presupuesto desde cero.");
    return ctx.answerCallbackQuery("Carrito vaciado.");
  }

  if (data === "action_configurar") {
    await ctx.answerCallbackQuery();
    return ctx.editMessageText("⚙️ *Configuración del Proyecto*\n\nAjustá los defaults de este cliente:", {
      parse_mode: "Markdown",
      reply_markup: buildConfigKeyboard(ctx.session)
    });
  }

  if (data === "edit_profit_margin") {
    ctx.session.awaitingProfitMargin = true;
    await ctx.answerCallbackQuery();
    return ctx.reply("✏️ Escribime en números el porcentaje de ganancia que querés sumarle al costo.\n(Ej: `40` para un 40% de ganancia)", { parse_mode: "Markdown" });
  }

  // --- SUBMENUS NAVIGATION ---
  if (data === "action_resumen") {
    await ctx.answerCallbackQuery();
    return ctx.editMessageText(formatProjectReply(ctx.session, null), {
      parse_mode: "Markdown",
      reply_markup: ctx.session.modules.length > 0 ? buildCartKeyboard(ctx.session) : undefined
    });
  }

  if (data === "menu_frentes") {
    await ctx.answerCallbackQuery();
    return ctx.editMessageReplyMarkup({ reply_markup: buildConfigMenuFrentes(ctx.session) });
  }
  if (data === "menu_interior") {
    await ctx.answerCallbackQuery();
    return ctx.editMessageReplyMarkup({ reply_markup: buildConfigMenuInterior(ctx.session) });
  }
  if (data === "menu_herrajes") {
      await ctx.answerCallbackQuery();
      return ctx.editMessageReplyMarkup({ reply_markup: buildConfigMenuHerrajes(ctx.session) });
  }

  // --- SETTINGS APPLIERS ---
  const applySettingAndGoBack = async (message: string) => {
    // Si queremos recalcular el carrito retroactivamente, lo haríamos acá:
    // ctx.session.modules = ctx.session.modules.map(mod => calculateQuote({ ...mod.request, frontMaterial: ctx.session.defaultFrontMaterial, ... }));
    
    await ctx.answerCallbackQuery(message);
    await ctx.editMessageText("⚙️ *Configuración del Proyecto*\n\nAjustá los defaults de este cliente:", {
      parse_mode: "Markdown",
      reply_markup: buildConfigKeyboard(ctx.session)
    });
  };

  if (data === "set_front_blanco") { ctx.session.defaultFrontMaterial = "blanco"; return applySettingAndGoBack("Frente Blanco asignado"); }
  if (data === "set_front_color") { ctx.session.defaultFrontMaterial = "color"; return applySettingAndGoBack("Frente Color asignado"); }
  if (data === "set_front_color_veta") { ctx.session.defaultFrontMaterial = "color_veta"; return applySettingAndGoBack("Frente Veta asignado"); }

  if (data === "set_int_15_blanco") { ctx.session.defaultInternalThickness = "15mm"; return applySettingAndGoBack("Interior Económico"); }
  if (data === "set_int_18_blanco") { ctx.session.defaultInternalThickness = "18mm"; return applySettingAndGoBack("Interior Estándar"); }
  if (data === "set_int_18_color") { ctx.session.defaultInternalThickness = "18mm_color"; return applySettingAndGoBack("Interior Premium"); }

  if (data === "set_hw_standard") { ctx.session.defaultHardwareTier = "standard"; return applySettingAndGoBack("Herrajes Zetas"); }
  if (data === "set_hw_premium") { ctx.session.defaultHardwareTier = "premium"; return applySettingAndGoBack("Herrajes Telescópicas"); }
  if (data === "set_hw_luxury") { ctx.session.defaultHardwareTier = "luxury"; return applySettingAndGoBack("Herrajes Ocultas"); }

  if (data.startsWith("delete_")) {
    const id = data.replace("delete_", "");
    const index = ctx.session.modules.findIndex(m => m.id === id);
    if (index !== -1) {
      ctx.session.modules = ctx.session.modules.filter(m => m.id !== id);
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
        `🧾 *REMITO: ${q.quote_id}*\n👤 Cliente: ${q.client_name}\n📅 Fecha: ${date}\n\n${formatProjectReply({ modules: q.modules }, null)}`,
        { parse_mode: "Markdown" }
      );
    } catch (error) {
      return ctx.reply("⚠️ Error al cargar el presupuesto.");
    }
  }

  return next();
});

import { Composer } from "grammy";
import { MyContext } from "../types";
import { supabase, createInvitation, getStats } from "../../db/supabase";
import { log } from "../utils/logger";
import { InlineKeyboard } from "grammy";

const adminId = parseInt(process.env.ADMIN_TELEGRAM_ID || "0", 10);

export const adminRouter = new Composer<MyContext>();

// Filtrar para que este router SOLO atienda al administrador
// Usamos .filter() idéntico al patrón asynctelebot_template
const adminBot = adminRouter.filter(ctx => ctx.from?.id === adminId);

adminBot.command("admin_usuarios", async (ctx) => {
  try {
    const { data: users, error } = await supabase
      .from("allowed_users")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) {
      log.error("ADMIN_USUARIOS", "Error consultando usuarios", error);
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
    log.error("ADMIN_USUARIOS", "Catch", error);
    await ctx.reply("⚠️ Error listando usuarios. Revisá los logs.");
  }
});

adminBot.command("admin_invitar", async (ctx) => {
  const maxUses = parseInt(ctx.match || "10", 10);
  const code = `INV_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  
  try {
    await createInvitation({ code, maxUses, createdBy: adminId });
    
    const botUsername = ctx.me.username;
    const link = `https://t.me/${botUsername}?start=${code}`;
    
    log.info("ADMIN", `Invitación creada: ${code}. Link: ${link}`);
    
    await ctx.reply(`🆕 *Invitación Generada*\n\n🔗 Link: ${link}\n🔑 Código: \`${code}\`\n👥 Usos: ${maxUses}`, { parse_mode: "Markdown" });
  } catch (error) {
    await ctx.reply("Error creando invitación.");
  }
});

adminBot.command("admin_stats", async (ctx) => {
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
    log.error("STATS", "Error calculando", error);
    await ctx.reply("⚠️ Error al calcular estadísticas.");
  }
});

// ── Administración de Precios ────────────────────────────────────────────────
const CATEGORIES: Record<string, { label: string, keys: string[] }> = {
  placas: { label: "📁 Placas", keys: ["board_18mm_white", "board_18mm_color", "board_15mm_white", "board_3mm"] },
  cantos: { label: "🎞 Tapacantos", keys: ["canto_roll_white", "canto_roll_color"] },
  herrajes: { label: "⚙️ Herrajes", keys: ["hw_hinge_std", "hw_hinge_pre", "hw_hinge_lux", "hw_slide_std", "hw_slide_pre", "hw_slide_lux", "hw_sliding_std", "hw_sliding_pre", "hw_sliding_lux"] }
};

adminBot.command("admin_precios", async (ctx) => {
  const keyboard = new InlineKeyboard();
  Object.entries(CATEGORIES).forEach(([id, cat]) => {
    keyboard.text(cat.label, `admin_cat_${id}`).row();
  });

  await ctx.reply("💰 *Gestión de Precios*\nElegí una categoría para editar:", {
    parse_mode: "Markdown",
    reply_markup: keyboard
  });
});

adminBot.callbackQuery(/^admin_cat_(.+)$/, async (ctx) => {
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

adminBot.callbackQuery("admin_precios_root", async (ctx) => {
  const keyboard = new InlineKeyboard();
  Object.entries(CATEGORIES).forEach(([id, cat]) => {
    keyboard.text(cat.label, `admin_cat_${id}`).row();
  });
  await ctx.editMessageText("💰 *Gestión de Precios*\nElegí una categoría para editar:", {
    parse_mode: "Markdown",
    reply_markup: keyboard
  });
});

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

adminBot.callbackQuery(/^admin_edit_(.+)$/, async (ctx) => {
  const key = ctx.match[1];
  ctx.session.awaitingPriceKey = key;
  
  await ctx.editMessageText(`✍️ *Editando: ${KEY_LABELS[key] || key}*\n\nIngresá el nuevo valor numérico (solo el número, ej: 12500):`, {
    parse_mode: "Markdown",
    reply_markup: new InlineKeyboard().text("❌ Cancelar", "admin_precios_root")
  });
});

import { updateBotSetting } from "../../db/supabase";
import { refreshPrices } from "../../engine/pricing";

// Middleware para capturar el nuevo valor del precio
adminBot.on("message:text", async (ctx, next) => {
  if (ctx.session.awaitingPriceKey) {
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

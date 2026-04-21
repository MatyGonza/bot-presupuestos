import { saveQuote } from "../../db/supabase";
import { calculateCartTotals } from "../../engine/pricing";
import { MyContext } from "../types";
import { formatProjectReply } from "../utils/formatters";
import { log } from "../utils/logger";

export async function executeArchive(ctx: MyContext, clientName: string) {
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
    await ctx.reply(`✅ *¡Presupuesto ${quoteId} guardado con éxito!*\n\nTu carrito sigue lleno. Podés seguir agregando o usar los botones de acción para limpiarlo.`);
  } catch (error) {
    if (error instanceof Error) {
      log.error("ARCHIVE", "Error guardando presupuesto", error);
    } else {
      log.error("ARCHIVE", "Error desconocido guardando presupuesto", new Error(String(error)));
    }
    await ctx.reply("⚠️ Hubo un error al guardar el presupuesto en la base de datos.");
  }
}

import { InlineKeyboard } from "grammy";
import { SessionData } from "../types";

export function buildCartKeyboard(session: SessionData): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  session.modules.forEach((mod, idx) => {
    keyboard.text(`✖️ Borrar #${idx + 1}`, `delete_${mod.id}`);
    if ((idx + 1) % 3 === 0) keyboard.row();
  });
  
  // Salto de línea por seguridad si la fila de borrados quedó incompleta
  if (session.modules.length % 3 !== 0) keyboard.row();

  keyboard.text("💾 Guardar", "action_guardar")
          .text("🗑️ Vaciar", "action_limpiar")
          .row()
          .text("⚙️ Configurar Proyecto", "action_configurar");

  return keyboard;
}

export function buildConfigKeyboard(session: SessionData): InlineKeyboard {
  const front = session.defaultFrontMaterial || "blanco";
  const thickness = session.defaultInternalThickness || "18mm";
  const tier = session.defaultHardwareTier || "premium";
  const tierLabel = tier === 'standard' ? '💰 Económico' : tier === 'luxury' ? '💎 Luxury' : '⭐ Premium';
  
  const margin = session.tenantSettings?.margin || 1.0;
  const marginPercent = Math.round((margin - 1) * 100);

  return new InlineKeyboard()
    .text(`🎨 Frentes: ${front.toUpperCase()} 🔄`, "toggle_front_material").row()
    .text(`📐 Interior: ${thickness} 🔄`, "toggle_internal_thickness").row()
    .text(`🔩 Herrajes: ${tierLabel}`, "cycle_hardware_tier").row()
    .text(`📈 Mi Rentabilidad: +${marginPercent}% ✏️`, "edit_profit_margin");
}

export function buildHistoryKeyboard(quotes: any[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  quotes.forEach((q) => {
    const date = new Date(q.created_at).toLocaleDateString('es-AR');
    keyboard.text(`🧾 ${q.quote_id} · ${q.client_name} · ${date}`, `quote_${q.quote_id}`).row();
  });
  return keyboard;
}

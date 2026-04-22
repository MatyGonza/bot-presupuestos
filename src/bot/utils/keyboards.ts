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
  const front = session.defaultFrontMaterial === 'color_veta' ? 'COLOR VETA' : (session.defaultFrontMaterial || "blanco").toUpperCase();
  const thickness = session.defaultInternalThickness === '18mm_color' ? "18mm COLOR" : (session.defaultInternalThickness || "18mm");
  const tier = session.defaultHardwareTier || "premium";
  const tierLabel = tier === 'standard' ? '💰 Económico' : tier === 'luxury' ? '💎 Luxury' : '⭐ Premium';
  
  const margin = session.tenantSettings?.margin || 1.0;
  const marginPercent = Math.round((margin - 1) * 100);

  return new InlineKeyboard()
    .text(`🎨 Frentes: ${front} ⚙️`, "menu_frentes").row()
    .text(`📐 Interior: ${thickness} ⚙️`, "menu_interior").row()
    .text(`🔩 Herrajes: ${tierLabel} ⚙️`, "menu_herrajes").row()
    .text(`📈 Mi Rentabilidad: +${marginPercent}% ✏️`, "edit_profit_margin").row()
    .text(`🔙 Volver al Presupuesto`, "action_resumen");
}

export function buildConfigMenuFrentes(session: SessionData): InlineKeyboard {
  const k = new InlineKeyboard();
  const current = session.defaultFrontMaterial || "blanco";
  k.text(current === "blanco" ? "✅ Liso (Blanco)" : "Liso (Blanco)", "set_front_blanco").row();
  k.text(current === "color" ? "✅ Color Liso" : "Color Liso", "set_front_color").row();
  k.text(current === "color_veta" ? "✅ Color c/ Veta (+20% desp)" : "Color c/ Veta (+20% desp)", "set_front_color_veta").row();
  k.text("🔙 Atrás", "action_configurar");
  return k;
}

export function buildConfigMenuInterior(session: SessionData): InlineKeyboard {
  const k = new InlineKeyboard();
  const current = session.defaultInternalThickness || "18mm";
  k.text(current === "15mm" ? "✅ 15mm Blanco (Económico)" : "15mm Blanco (Económico)", "set_int_15_blanco").row();
  k.text(current === "18mm" ? "✅ 18mm Blanco (Estándar)" : "18mm Blanco (Estándar)", "set_int_18_blanco").row();
  k.text(current === "18mm_color" ? "✅ 18mm Color (Premium)" : "18mm Color (Premium)", "set_int_18_color").row();
  k.text("🔙 Atrás", "action_configurar");
  return k;
}

export function buildConfigMenuHerrajes(session: SessionData): InlineKeyboard {
  const k = new InlineKeyboard();
  const current = session.defaultHardwareTier || "premium";
  k.text(current === "standard" ? "✅ 💰 Económico (Zetas/Común)" : "💰 Económico (Zetas/Común)", "set_hw_standard").row();
  k.text(current === "premium" ? "✅ ⭐ Premium (Tele/Suave)" : "⭐ Premium (Tele/Suave)", "set_hw_premium").row();
  k.text(current === "luxury" ? "✅ 💎 Luxury (Oculto/Gola)" : "💎 Luxury (Oculto/Gola)", "set_hw_luxury").row();
  k.text("🔙 Atrás", "action_configurar");
  return k;
}

export function buildHistoryKeyboard(quotes: any[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  quotes.forEach((q) => {
    const date = new Date(q.created_at).toLocaleDateString('es-AR');
    keyboard.text(`🧾 ${q.quote_id} · ${q.client_name} · ${date}`, `quote_${q.quote_id}`).row();
  });
  return keyboard;
}

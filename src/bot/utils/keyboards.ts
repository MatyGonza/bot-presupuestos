import { InlineKeyboard } from "grammy";
import { SessionData } from "../types";

export function buildCartKeyboard(session: SessionData): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  session.modules.forEach((mod, idx) => {
    keyboard.text(`✖️ Borrar #${idx + 1}`, `delete_${mod.id}`);
    if ((idx + 1) % 3 === 0) keyboard.row();
  });
  return keyboard;
}

export function buildConfigKeyboard(session: SessionData): InlineKeyboard {
  const front = session.defaultFrontMaterial || "blanco";
  const thickness = session.defaultInternalThickness || "18mm";
  const tier = session.defaultHardwareTier || "premium";
  const tierLabel = tier === 'standard' ? '💰 Económico' : tier === 'luxury' ? '💎 Luxury' : '⭐ Premium';
  return new InlineKeyboard()
    .text(`🎨 Frentes: ${front.toUpperCase()} 🔄`, "toggle_front_material").row()
    .text(`📐 Interior: ${thickness} 🔄`, "toggle_internal_thickness").row()
    .text(`🔩 Herrajes: ${tierLabel}`, "cycle_hardware_tier");
}

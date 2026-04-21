import { z } from "zod";
import { QuoteResult } from "../../engine/types";
import { SessionData } from "../types";
import { calculateCartTotals } from "../../engine/pricing";

export function formatModuleDetail(mod: QuoteResult): string {
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

export function formatValidationErrors(rawModule: any, zError: z.ZodError): string {
  const errs = zError.issues.map(iss => {
    const path = iss.path.join('.');
    if (path === 'module') return "El tipo de mueble no es reconocido. (Intentá especificar: bajo mesada, alacena, placard o cajonera).";
    if (path.startsWith('dimensions.')) return `Faltó especificar una medida (${iss.path[1] === 'width' ? 'largo/ancho' : iss.path[1] === 'height' ? 'alto' : 'profundidad'}).`;
    if (path === 'dimensions') return "Faltó especificar el tamaño (ancho, alto, profundidad).";
    return iss.message;
  });
  
  const attemptedName = (typeof rawModule?.module === 'string') ? rawModule.module : "Módulo sin identificar";
  return `• ❌ *${attemptedName}*:\n    - ${Array.from(new Set(errs)).join('\n    - ')}`;
}

export function formatProjectReply(sessionData: SessionData, lastAddedBatch: QuoteResult[] | null, failedModules: string[] = []): string {
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

  if (failedModules.length > 0) {
    reply += `⚠️ *Me faltaron datos para cotizar lo siguiente:*\n${failedModules.join("\n")}\n_¿Me pasás las medidas que faltan?_\n\n`;
  }

  reply += `_Comandos: /limpiar para vaciar el carrito._`;

  return reply;
}

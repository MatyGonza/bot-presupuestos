import { z } from "zod";
import { QuoteRequest } from "../../engine/types";

// ── Schemas de validación compartidos ─────────────────────────────────────────

export const quoteSchema = z.object({
  module: z.enum(["bajo_mesada", "alacena", "placard", "cajonera"]),
  dimensions: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    depth: z.number().optional()
  }).optional(),
  drawerCount: z.number().optional(),
  shelfCount: z.number().optional(),
  frontMaterial: z.enum(["blanco", "color"]).optional()
});

export const quoteArraySchema = z.array(quoteSchema);

// ── Utilidades compartidas ────────────────────────────────────────────────────

/**
 * Retorna un QuoteRequest válido inyectando medidas por defecto si el esquema está incompleto.
 */
export function fillDefaults(req: any): any {
  const isMissing = !req.dimensions || !req.dimensions.width || !req.dimensions.height || !req.dimensions.depth;
  let width = req.dimensions?.width;
  let height = req.dimensions?.height;
  let depth = req.dimensions?.depth;

  if (isMissing) {
    if (req.module === 'cajonera')         { height = height ?? 800;  width = width ?? 600;  depth = depth ?? 500; }
    else if (req.module === 'bajo_mesada') { height = height ?? 800;  width = width ?? 600;  depth = depth ?? 600; }
    else if (req.module === 'alacena')     { height = height ?? 600;  width = width ?? 600;  depth = depth ?? 300; }
    else if (req.module === 'placard')     { height = height ?? 2500; width = width ?? 2000; depth = depth ?? 600; }
    height = height ?? 1000; width = width ?? 1000; depth = depth ?? 500;
  }
  // Sanity check: ningún mueble real supera 5000mm (5m) en ningún eje.
  // Si el LLM multiplicó por 1000 en vez de por 10 (confundió cm con m), corregimos.
  const MAX_SANE_MM = 5000;
  if (width > MAX_SANE_MM)  width = Math.round(width / 100);
  if (height > MAX_SANE_MM) height = Math.round(height / 100);
  if (depth > MAX_SANE_MM)  depth = Math.round(depth / 100);

  return { ...req, dimensions: { width, height, depth }, dimensionsAssumed: isMissing };
}

export function parseAndValidate(text: string): any[] {
  const cleanText = text.replace(/```json/i, "").replace(/```/g, "").trim();
  let parsedJson;
  try {
    parsedJson = JSON.parse(cleanText);
  } catch (e) {
    throw new Error("NLU_PARSE_ERROR");
  }
  
  if (!Array.isArray(parsedJson)) {
    // A veces devuelve un solo objeto en vez de array
    if (typeof parsedJson === 'object' && parsedJson !== null) {
      parsedJson = [parsedJson];
    } else {
      throw new Error("NLU_PARSE_ERROR");
    }
  }

  // Llenamos defaults y retornamos crudo para que telegram.ts valide individualmente
  return parsedJson.map(fillDefaults);
}

export const PROMPT_RULES = `
Tipos de módulos permitidos: "bajo_mesada", "alacena", "placard", "cajonera".
Devolvé ÚNICAMENTE un JSON válido que sea un ARRAY de objetos con este formato exacto:
[
  {
    "module": "bajo_mesada",
    "dimensions": { "width": 1000, "height": 800, "depth": 600 },
    "drawerCount": 3,
    "shelfCount": 2,
    "frontMaterial": "color"
  }
]

CONVERSIÓN DE UNIDADES (MUY IMPORTANTE):
- En carpintería argentina, cuando alguien dice un número SIN unidad (ej: "80 de alto"), SIEMPRE se refiere a CENTÍMETROS.
- 80 (centímetros) = 800 milímetros. Multiplicás por 10.
- 1 metro = 1000 milímetros. Multiplicás por 1000.
- "58 de profundidad" = 58 cm = 580 mm
- "75 de alto" = 75 cm = 750 mm
- "1 metro de ancho" = 100 cm = 1000 mm
- NUNCA vas a recibir valores en metros sueltos como "80 metros". Eso no existe en muebles.

Reglas adicionales:
- Extraé la cantidad de cajones ("drawerCount") y estantes interiores ("shelfCount") si el usuario lo menciona. Si no lo dice, eliminalos (no mandes null).
- Si mencionan que el color de las puertas o exterior es de madera, un color específico (Jade, negro, etc.), extraé "frontMaterial" como "color". Si dice explícitamente blanco, usá "blanco". Si no dice nada sobre colores, no lo incluyas.
- Si mencionan múltiples muebles, agregalos a todos dentro del mismo Array JSON.
- Si no están seguros del tipo de módulo, asumí "bajo_mesada".
- No agregues texto fuera del JSON. Sólo la respuesta estructurada.`;

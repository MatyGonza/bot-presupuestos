import Groq from "groq-sdk";
import { QuoteRequest } from "../../engine/types";
import { INLUProvider } from "./types";
import { quoteArraySchema, fillDefaults } from "./shared";

const SYSTEM_PROMPT = `Sos un experto fabricante de muebles argentino. Analizá el texto (puede ser la transcripción de un audio) y extraé los módulos de muebles con sus medidas en milímetros.
Tipos de módulos permitidos: "bajo_mesada", "alacena", "placard", "cajonera".
Devolvé ÚNICAMENTE un JSON válido que sea un ARRAY de objetos con este formato exacto:
[{ "module": "bajo_mesada", "dimensions": { "width": 1000, "height": 800, "depth": 600 }, "drawerCount": 3, "shelfCount": 2, "frontMaterial": "color" }]

CONVERSIÓN DE UNIDADES (MUY IMPORTANTE):
- En carpintería argentina, cuando alguien dice un número SIN unidad (ej: "80 de alto"), SIEMPRE se refiere a CENTÍMETROS.
- 80 (centímetros) = 800 milímetros. Multiplicás por 10.
- 1 metro = 1000 milímetros. Multiplicás por 1000.
- "58 de profundidad" = 58 cm = 580 mm
- "75 de alto" = 75 cm = 750 mm
- "1 metro de ancho" = 100 cm = 1000 mm
- NUNCA vas a recibir valores en metros sueltos como "80 metros". Eso no existe en muebles.

Reglas adicionales:
- Extraé "drawerCount" y "shelfCount" si se mencionan. Si no, no los incluyas.
- "frontMaterial": "color" si mencionan madera o un color específico. "blanco" si dicen blanco explícitamente. Omitir si no se menciona.
- Si hay varios muebles, todos van en el mismo array.
- Por defecto asumí "bajo_mesada" si no está claro el tipo.
- No agregues texto fuera del JSON.`;

// ── Implementación ────────────────────────────────────────────────────────────

export class GroqProvider implements INLUProvider {
  private client: Groq;
  private textModel = "llama-3.3-70b-versatile";
  private audioModel = "whisper-large-v3";

  constructor(apiKey: string) {
    this.client = new Groq({ apiKey });
  }

  async parseAudio(audioBuffer: Buffer, mimeType: string): Promise<any[]> {
    // PASO 1: Transcribir el audio con Whisper
    console.log(`[Groq] 🎙️ Transcribiendo audio con ${this.audioModel}...`);

    const extension = mimeType.includes("ogg") ? "ogg" : "mp3";
    const audioFile = new File([new Uint8Array(audioBuffer)], `audio.${extension}`, { type: mimeType });

    const transcription = await this.client.audio.transcriptions.create({
      file: audioFile,
      model: this.audioModel,
      language: "es",
      response_format: "text"
    });

    const transcribedText = typeof transcription === "string" ? transcription : (transcription as any).text;
    console.log(`[Groq] 📝 Transcripción: "${transcribedText}"`);

    // PASO 2: Extraer JSON con el LLM de texto
    return this.parseText(transcribedText);
  }

  async parseText(userText: string): Promise<any[]> {
    console.log(`[Groq] 🌐 Extrayendo módulos con ${this.textModel}...`);

    const response = await this.client.chat.completions.create({
      model: this.textModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    const raw = response.choices[0]?.message?.content ?? "[]";
    console.log("[Groq] 📜 Respuesta cruda:\n", raw);

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`[Groq] JSON inválido devuelto por el modelo: ${raw}`);
    }

    // Normalizar: Llama puede devolver:
    //   [{ module: ... }]              → ya es array, usar directo
    //   { modules: [{ module: ... }] } → extraer la propiedad array
    //   { module: "bajo_mesada", ... }  → objeto suelto, wrappear en array
    let arr: any[];
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed.modules) {
      arr = parsed.modules;
    } else if (parsed.muebles) {
      arr = parsed.muebles;
    } else if (parsed.items) {
      arr = parsed.items;
    } else if (parsed.module) {
      // Caso: objeto suelto con key "module" → es UN módulo, wrappear
      arr = [parsed];
    } else {
      // Último recurso: tomar el primer valor que sea array
      const firstArray = Object.values(parsed).find(v => Array.isArray(v));
      arr = (firstArray as any[]) ?? [];
    }

    const validated = quoteArraySchema.parse(arr);
    return validated.map(fillDefaults);
  }
}

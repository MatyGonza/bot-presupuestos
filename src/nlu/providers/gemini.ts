import { GoogleGenerativeAI } from "@google/generative-ai";
import { QuoteRequest } from "../../engine/types";
import { INLUProvider } from "./types";
import { parseAndValidate, PROMPT_RULES } from "./shared";

// ── Retry logic ───────────────────────────────────────────────────────────────

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 3, initialDelayMs = 1000): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRateLimitError = error?.status === 429 || error?.message?.includes("429");
      if (!isRateLimitError || attempt === maxRetries - 1) throw error;
      const delayMs = initialDelayMs * Math.pow(2, attempt);
      console.warn(`[Gemini] Rate limited. Retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

// ── Implementación ────────────────────────────────────────────────────────────

export class GeminiProvider implements INLUProvider {
  private genAI: GoogleGenerativeAI;
  private modelName = "gemini-2.0-flash";

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
  }

  private getModel() {
    return this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: { responseMimeType: "application/json" }
    });
  }

  async parseAudio(audioBuffer: Buffer, mimeType: string): Promise<QuoteRequest[]> {
    const model = this.getModel();
    const prompt = `Sos un experto fabricante de muebles. Escuchá el audio y extraé las medidas (en milímetros) y los tipos de módulo.\n${PROMPT_RULES}`;
    const audioPart = { inlineData: { data: audioBuffer.toString("base64"), mimeType } };

    console.log(`[Gemini] 🌐 Conectando para analizar audio (modelo: ${this.modelName})...`);
    const result = await retryWithBackoff(() => model.generateContent([prompt, audioPart]));
    const text = result.response.text();
    console.log("[Gemini] 📜 Respuesta cruda:\n", text);
    return parseAndValidate(text);
  }

  async parseText(userText: string): Promise<QuoteRequest[]> {
    const model = this.getModel();
    const prompt = `Sos un experto fabricante de muebles. Analizá el texto y extraé las medidas (en milímetros) y los tipos de módulo.\n${PROMPT_RULES}\n\nTexto del cliente: "${userText}"`;

    console.log("[Gemini] 🌐 Conectando para analizar texto...");
    const result = await retryWithBackoff(() => model.generateContent([prompt]));
    const text = result.response.text();
    console.log("[Gemini] 📜 Respuesta cruda:\n", text);
    return parseAndValidate(text);
  }
}

import { QuoteRequest } from "../engine/types";
import { INLUProvider } from "./providers/types";
import { createNLUProvider } from "./providers/factory";

// Lazy singleton — se crea SOLO la primera vez que se necesita,
// cuando dotenv.config() ya se ejecutó en telegram.ts
let _provider: INLUProvider | null = null;

function getProvider(): INLUProvider {
  if (!_provider) {
    _provider = createNLUProvider();
  }
  return _provider;
}

/**
 * Analiza un audio OGG y devuelve los módulos de muebles detectados.
 * El proveedor activo (Gemini o Groq) es transparente para el llamador.
 */
export async function parseAudioToQuote(
  audioBuffer: Buffer,
  mimeType: string,
  _apiKey: string  // Mantenido por compatibilidad — la key viene del .env vía factory
): Promise<QuoteRequest[]> {
  return getProvider().parseAudio(audioBuffer, mimeType);
}

/**
 * Analiza texto libre y devuelve los módulos de muebles detectados.
 * El proveedor activo (Gemini o Groq) es transparente para el llamador.
 */
export async function parseTextToQuote(
  userText: string,
  _apiKey: string  // Mantenido por compatibilidad — la key viene del .env vía factory
): Promise<QuoteRequest[]> {
  return getProvider().parseText(userText);
}

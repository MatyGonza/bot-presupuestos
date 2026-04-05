import { INLUProvider } from "./types";
import { GeminiProvider } from "./gemini";
import { GroqProvider } from "./groq";

/**
 * Lee la variable de entorno AI_PROVIDER y devuelve la instancia correcta.
 * 
 * Uso en .env:
 *   AI_PROVIDER=gemini   → usa Google Gemini (default)
 *   AI_PROVIDER=groq     → usa Groq (Whisper + Llama)
 */
export function createNLUProvider(): INLUProvider {
  const provider = (process.env.AI_PROVIDER || "gemini").toLowerCase().trim();

  switch (provider) {
    case "groq": {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        throw new Error(
          "❌ AI_PROVIDER=groq pero falta GROQ_API_KEY en el .env.\n" +
          "   Conseguila gratis en: https://console.groq.com/keys"
        );
      }
      console.log("[NLU Factory] 🟣 Usando proveedor: GROQ (Whisper + Llama)");
      return new GroqProvider(apiKey);
    }

    case "gemini":
    default: {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("❌ Falta GEMINI_API_KEY en el .env.");
      }
      console.log("[NLU Factory] 🔵 Usando proveedor: GEMINI (gemini-2.0-flash)");
      return new GeminiProvider(apiKey);
    }
  }
}

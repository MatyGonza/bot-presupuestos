import { QuoteRequest } from "../../engine/types";

/**
 * Interfaz que deben implementar todos los proveedores de NLU.
 * Define el contrato para analizar audio y texto y devolver módulos de cotización.
 */
export interface INLUProvider {
  /**
   * Analiza un buffer de audio y extrae los módulos de muebles detectados.
   */
  parseAudio(audioBuffer: Buffer, mimeType: string): Promise<QuoteRequest[]>;

  /**
   * Analiza texto libre y extrae los módulos de muebles detectados.
   */
  parseText(userText: string): Promise<QuoteRequest[]>;
}

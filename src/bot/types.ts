import { Context, SessionFlavor } from "grammy";
import { QuoteResult } from "../engine/types";

// 1. Definir la estructura de la Sesión (Carrito)
export interface SessionData {
  modules: QuoteResult[];
  awaitingClientName?: boolean;
  awaitingPriceKey?: string; // Para el flujo de /admin_precios
  defaultFrontMaterial?: "blanco" | "color";
  defaultHardwareTier?: "standard" | "premium" | "luxury";
  defaultInternalThickness?: "18mm" | "15mm";
}

export type MyContext = Context & SessionFlavor<SessionData>;

export interface NluProcessResult {
  validQuotes: QuoteResult[];
  errorMessages: string[];
}

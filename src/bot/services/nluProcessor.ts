import { parseTextToQuote, parseAudioToQuote } from "../../nlu/parser";
import { fillDefaults } from "../../nlu/providers/shared";
import { calculateQuote } from "../../engine/pricing";
import { QuoteRequestSchema, QuoteRequest, QuoteResult } from "../../engine/types";
import { formatValidationErrors } from "../utils/formatters";
import { log } from "../utils/logger";
import { SessionData, NluProcessResult } from "../types";
import { downloadTelegramAudio } from "../../nlu/providers/downloader";


export async function processTextQuote(text: string, sessionContext: SessionData): Promise<NluProcessResult> {
  const quoteRequestsArrayRaw = await parseTextToQuote(text, "");
  return processParsedRequests(quoteRequestsArrayRaw, sessionContext);
}

export async function processAudioQuote(botToken: string, filePath: string, sessionContext: SessionData): Promise<NluProcessResult> {
  // Encapsulated Network Call
  const buffer = await downloadTelegramAudio(botToken, filePath);
  
  const quoteRequestsArrayRaw = await parseAudioToQuote(buffer, "audio/ogg", "");
  return processParsedRequests(quoteRequestsArrayRaw, sessionContext);
}

async function processParsedRequests(rawRequests: any[], sessionContext: SessionData): Promise<NluProcessResult> {
  const quoteRequestsArray: QuoteRequest[] = [];
  const errorMessages: string[] = [];

  rawRequests.forEach(q => {
    const qWithDefaults = fillDefaults(q);
    const result = QuoteRequestSchema.safeParse(qWithDefaults);
    if (!result.success) {
      log.warn("NLU_VALIDATION", `Módulo descartado: ${JSON.stringify(result.error.format())}`);
      errorMessages.push(formatValidationErrors(q, result.error));
    } else {
      quoteRequestsArray.push(result.data);
    }
  });

  const validQuotes = await Promise.all(quoteRequestsArray.map(q => calculateQuote({
    ...q,
    frontMaterial: q.frontMaterial || sessionContext.defaultFrontMaterial,
    hardwareTier: q.hardwareTier || sessionContext.defaultHardwareTier,
    internalThickness: q.internalThickness || sessionContext.defaultInternalThickness,
  })));

  return {
    validQuotes,
    errorMessages
  };
}

import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";

dotenv.config();

const geminiKey = process.env.GEMINI_API_KEY;

if (!geminiKey) {
  console.error("Faltan GEMINI_API_KEY");
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(geminiKey);

async function listModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`;
  const response = await fetch(url);
  const data = await response.json();
  console.log("Modelos disponibles:", data.models.map((m: any) => m.name));
}

listModels();

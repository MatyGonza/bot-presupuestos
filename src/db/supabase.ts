import { createClient } from "@supabase/supabase-js";
import { QuoteResult } from "../engine/types";
import * as dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.warn("⚠️ SUPABASE_URL o SUPABASE_SERVICE_KEY no configuradas en .env.");
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// ── Tipos de DB ───────────────────────────────────────────────────────────────

export interface AllowedUser {
  id: number;
  telegram_id: number;
  name: string | null;
  username: string | null;
  invited_by_code: string | null;
  role: "admin" | "user";
  created_at: string;
}

export interface Invitation {
  id: number;
  code: string;
  max_uses: number | null;
  used_count: number;
  created_by: number;
  active: boolean;
  created_at: string;
}

export interface SavedQuote {
  id: number;
  quote_id: string;
  telegram_id: number;
  client_name: string;
  modules: any[];
  totals: any;
  config: any;
  created_at: string;
}

// ── Helpers de Usuarios ───────────────────────────────────────────────────────

/**
 * Verifica si un usuario está en la allowlist.
 */
export async function isUserAllowed(telegramId: number | string): Promise<boolean> {
  const { data, error } = await supabase
    .from("allowed_users")
    .select("id")
    .eq("telegram_id", telegramId.toString())
    .single();

  if (error || !data) return false;
  return true;
}

/**
 * Registra un nuevo usuario mediante un código de invitación.
 */
export async function registerUser(params: {
  telegramId: number;
  name: string;
  username?: string;
  code: string;
}): Promise<string> { // Retorna el nombre para avisar al admin
  // 1. Validar invitación
  const { data: invite, error: inviteErr } = await supabase
    .from("invitations")
    .select("*")
    .eq("code", params.code)
    .eq("active", true)
    .single();

  if (inviteErr || !invite) throw new Error("Código de invitación inválido o inactivo.");
  if (invite.max_uses !== null && invite.used_count >= invite.max_uses) {
    throw new Error("Este código de invitación ya agotó sus usos.");
  }

  // 2. Insertar usuario
  const { error: userErr } = await supabase
    .from("allowed_users")
    .insert([{
      telegram_id: params.telegramId,
      name: params.name,
      username: params.username || null,
      invited_by_code: params.code
    }]);

  if (userErr) throw userErr;

  // 3. Incrementar contador de la invitación
  await supabase
    .from("invitations")
    .update({ used_count: invite.used_count + 1 })
    .eq("id", invite.id);

  return params.username ? `@${params.username}` : params.name;
}

// ... (Rest of existing code remains same until end)

/**
 * Obtiene todas las configuraciones del bot (precios).
 */
export async function getBotSettings(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("bot_settings")
    .select("key, value");

  if (error) {
    console.error("Error al leer bot_settings:", error);
    return {};
  }
  
  const settings: Record<string, number> = {};
  data?.forEach((row: any) => {
    settings[row.key] = row.value;
  });
  
  return settings;
}

/**
 * Actualiza una configuración específica.
 */
export async function updateBotSetting(key: string, value: number): Promise<void> {
  const { error } = await supabase
    .from("bot_settings")
    .update({ value, updated_at: new Date().toISOString() })
    .eq("key", key);

  if (error) throw error;
}

// ── Helpers de Invitaciones ───────────────────────────────────────────────────

/**
 * Genera un nuevo código de invitación (solo para admins).
 */
export async function createInvitation(params: {
  code: string;
  maxUses?: number;
  createdBy: number;
}): Promise<void> {
  const { error } = await supabase
    .from("invitations")
    .insert([{
      code: params.code,
      max_uses: params.maxUses ?? 10,
      created_by: params.createdBy
    }]);

  if (error) throw error;
}

// ── Helpers de Presupuestos ───────────────────────────────────────────────────

/**
 * Archiva un presupuesto en la base de datos.
 */
export async function saveQuote(params: {
  quoteId: string;
  telegramId: number;
  clientName: string;
  modules: QuoteResult[];
  totals: any;
  config: any;
}): Promise<void> {
  const { error } = await supabase
    .from("quotes")
    .insert([{
      quote_id: params.quoteId,
      telegram_id: params.telegramId,
      client_name: params.clientName,
      modules: params.modules,
      totals: params.totals,
      config: params.config
    }]);

  if (error) throw error;
}

/**
 * Recupera los últimos presupuestos de un usuario.
 */
export async function getQuotesByUser(telegramId: number, limit = 5): Promise<SavedQuote[]> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Busca un presupuesto por su ID corto (COT-XXXXX).
 */
export async function getQuoteById(quoteId: string): Promise<SavedQuote | null> {
  const { data, error } = await supabase
    .from("quotes")
    .select("*")
    .eq("quote_id", quoteId)
    .single();

  if (error || !data) return null;
  return data;
}

// ── KPIs y Estadísticas ───────────────────────────────────────────────────────

export interface BotStats {
  totalUsers: number;
  totalQuotes: number;
  quotesToday: number;
  quotesThisWeek: number;
  avgTicket: number;
  topModule: string;
  mostActiveUser: { name: string | null; count: number } | null;
}

/**
 * Obtiene las estadísticas generales del bot para el panel de administración.
 */
export async function getStats(): Promise<BotStats> {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Total usuarios registrados
  const { count: totalUsers } = await supabase
    .from("allowed_users")
    .select("*", { count: "exact", head: true });

  // 2. Todos los presupuestos para hacer los cálculos
  const { data: allQuotes } = await supabase
    .from("quotes")
    .select("telegram_id, totals, modules, created_at");

  const quotes = allQuotes || [];
  const totalQuotes = quotes.length;

  // 3. Hoy y esta semana
  const quotesToday = quotes.filter(q => q.created_at >= todayStart).length;
  const quotesThisWeek = quotes.filter(q => q.created_at >= weekStart).length;

  // 4. Ticket promedio
  const tickets = quotes
    .map(q => parseFloat(q.totals?.grandTotal || "0"))
    .filter(v => !isNaN(v) && v > 0);
  const avgTicket = tickets.length > 0
    ? tickets.reduce((a, b) => a + b, 0) / tickets.length
    : 0;

  // 5. Módulo más cotizado
  const moduleCounts: Record<string, number> = {};
  for (const q of quotes) {
    const mods: any[] = q.modules || [];
    for (const m of mods) {
      if (m.module) {
        moduleCounts[m.module] = (moduleCounts[m.module] || 0) + 1;
      }
    }
  }
  const topModule = Object.entries(moduleCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

  // 6. Usuario más activo
  const userCounts: Record<string, number> = {};
  for (const q of quotes) {
    const tid = String(q.telegram_id);
    userCounts[tid] = (userCounts[tid] || 0) + 1;
  }
  const topUserEntry = Object.entries(userCounts).sort((a, b) => b[1] - a[1])[0];
  let mostActiveUser = null;
  if (topUserEntry) {
    const { data: userData } = await supabase
      .from("allowed_users")
      .select("name, username")
      .eq("telegram_id", topUserEntry[0])
      .single();
    // Si no está en allowed_users (ej: el admin que bypasea auth), mostrar su ID
    const displayName = userData?.username
      ? `@${userData.username}`
      : userData?.name
      ? userData.name
      : `ID:${topUserEntry[0]}`;
    mostActiveUser = {
      name: displayName,
      count: topUserEntry[1]
    };
  }

  return {
    totalUsers: totalUsers || 0,
    totalQuotes,
    quotesToday,
    quotesThisWeek,
    avgTicket,
    topModule,
    mostActiveUser
  };
}

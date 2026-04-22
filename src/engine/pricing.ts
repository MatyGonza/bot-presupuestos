import { QuoteRequest, QuoteResult, CartTotals, MaterialRequirements } from "./types";
import { TenantSettings } from "../bot/types";
import { getBotSettings } from "../db/supabase";

// Cache de precios para evitar pegarle a la DB en cada cálculo
let priceCache: Record<string, number> = {};
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Carga los precios desde la DB.
 */
export async function refreshPrices(): Promise<void> {
    try {
        priceCache = await getBotSettings();
        lastFetch = Date.now();
        console.log("[Pricing] 📈 Precios actualizados desde la DB");
    } catch (e) {
        console.error("[Pricing] ❌ Error al refrescar precios:", e);
    }
}

/**
 * Obtiene un precio con fallback a valores hardcodeados por seguridad.
 */
function getPrice(key: string, fallback: number): number {
    return priceCache[key] ?? fallback;
}

// Board Physical Sizes (in m2) - Estas son constantes físicas, no cambian
const BOARD_SIZE_18MM_WHITE = 5.03;
const BOARD_SIZE_18MM_COLOR = 5.03;
const BOARD_SIZE_15MM_WHITE = 5.03;
const BOARD_SIZE_3MM = 4.75;
const CANTO_ROLL_SIZE = 50;

const WASTE_FACTOR_MULTIPLIER = 1.20; // +20% desperdicio

// Cajoneras internas default para Placard
const PLACARD_INT_CAJONERA_COUNT = 2;
const PLACARD_INT_CAJONERA_DRAWERS = 3;
const PLACARD_INT_CAJONERA_W = 500 / 1000;
const PLACARD_INT_CAJONERA_H = 600 / 1000;
const PLACARD_INT_CAJONERA_D = 500 / 1000;

// Hardware Strategy Pattern dictionary (Ahora dinámico)
const HARDWARE_STRATEGY: Record<string, (req: QuoteRequest) => { cost: number, breakdown: string[] }> = {
    'bajo_mesada': (req) => {
        const tier = req.hardwareTier || 'premium';
        let cost = 0;
        let breakdown: string[] = [];
        if (tier === 'standard') {
            cost = getPrice('hw_hinge_std', 4000);
            breakdown = ["4 Bisagras comunes + Tiradores plásticos"];
        } else if (tier === 'luxury') {
            cost = getPrice('hw_hinge_lux', 28000);
            breakdown = ["4 Bisagras Hettich Cierre Suave + Perfil Gola"];
        } else {
            cost = getPrice('hw_hinge_pre', 10800); // Premium
            breakdown = ["4 Bisagras Eurohard Cierre Suave + Perfil J/C"];
        }
        return { cost, breakdown };
    },
    'cajonera': (req) => {
        const drawerCount = req.drawerCount ?? 3;
        const tier = req.hardwareTier || 'premium';
        let unitCost = 0;
        let desc = "";

        if (tier === 'standard') {
            unitCost = getPrice('hw_slide_std', 4000);
            desc = "Guías Z Económicas";
        } else if (tier === 'luxury') {
            unitCost = getPrice('hw_slide_lux', 40400); // Antes 40000, unificamos a 40400 si querés o mantenemos
            desc = "Guías Ocultas / Tandembox";
        } else {
            unitCost = getPrice('hw_slide_pre', 10368);
            desc = "Telescópicas Cierre Suave Zinc";
        }
        return {
            cost: drawerCount * unitCost,
            breakdown: [`${drawerCount} par(es) ${desc}`]
        };
    },
    'alacena': (req) => {
        const tier = req.hardwareTier || 'premium';
        let cost = 0;
        let breakdown: string[] = [];
        if (tier === 'standard') {
            cost = getPrice('hw_hinge_std', 4000);
            breakdown = ["4 Bisagras comunes + Tiradores plásticos"];
        } else if (tier === 'luxury') {
            cost = getPrice('hw_hinge_lux', 28000);
            breakdown = ["4 Bisagras Hettich Cierre Suave + Puertas sin tirador (Push)"];
        } else {
            cost = getPrice('hw_hinge_pre', 10800);
            breakdown = ["4 Bisagras Eurohard Cierre Suave + Perfil Aluminio"];
        }
        return { cost, breakdown };
    },
    'placard': (req) => {
        const tier = req.hardwareTier || 'premium';
        let drawerUnitCost = 0;
        let drawerDesc = "";

        if (tier === 'standard') {
            drawerUnitCost = getPrice('hw_slide_std', 4000);
            drawerDesc = "Guías Z Económicas";
        } else if (tier === 'luxury') {
            drawerUnitCost = getPrice('hw_slide_lux', 40400);
            drawerDesc = "Guías Ocultas / Tandembox";
        } else {
            drawerUnitCost = getPrice('hw_slide_pre', 10368);
            drawerDesc = "Telescópicas Cierre Suave Zinc";
        }

        let sysCost = 0;
        let sysDesc = "";
        if (tier === 'standard') {
            sysCost = getPrice('hw_sliding_std', 18000); // Ajustamos a los keys del SQL
            sysDesc = "Kit corredizo económico plástico";
        } else if (tier === 'luxury') {
            sysCost = getPrice('hw_sliding_lux', 120000);
            sysDesc = "Kit corredizo Ducasse Premium C/Suave";
        } else {
            sysCost = getPrice('hw_sliding_pre', 60000);
            sysDesc = "Kit corredizo + Perfilería Aluminio";
        }

        // Cajoneras internas: 2 unidades × 3 cajones = 6 pares de guías
        const intDrawerTotal = PLACARD_INT_CAJONERA_COUNT * PLACARD_INT_CAJONERA_DRAWERS;

        const breakdown = [
            sysDesc,
            `${PLACARD_INT_CAJONERA_COUNT} Cajoneras internas (${PLACARD_INT_CAJONERA_DRAWERS} cajones c/u) → ${intDrawerTotal} par(es) ${drawerDesc}`
        ];

        return {
            cost: sysCost + (intDrawerTotal * drawerUnitCost),
            breakdown
        };
    }
};

function getDoorCount(widthMm: number): number {
    if (widthMm <= 500) return 1;
    if (widthMm <= 1500) return 2;
    return 3;
}

function calculateSurfaceArea(req: QuoteRequest): { area18mmWhite: number, area15mmWhite: number, area18mmColor: number, area3mm: number, shelfCount: number, doorCount: number } {
    const w = req.dimensions.width / 1000;
    const h = req.dimensions.height / 1000;
    const d = req.dimensions.depth / 1000;

    let area18mmWhite = 0;
    let area15mmWhite = 0;
    let area18mmColor = 0;
    let area3mm = 0;

    // Defaults de estantes solicitados por el usuario
    let shelfCount = req.shelfCount ?? 0;
    if ((req.module === 'bajo_mesada' || req.module === 'alacena') && req.shelfCount === undefined) {
        shelfCount = 1;
    }

    let doorCount = 0;
    if (req.module === 'cajonera') {
        doorCount = req.drawerCount ?? 3;
    } else {
        doorCount = getDoorCount(req.dimensions.width);
    }

    // Fondo trasero exterior
    area3mm += (h * w);

    // FRENTES: Siempre 18mm, definidos por el color
    const frontArea = (h * w);
    const isColor = req.frontMaterial === 'color' || req.frontMaterial === 'color_veta';
    const vetaPenalty = req.frontMaterial === 'color_veta' ? 1.15 : 1.0;

    if (isColor) {
        area18mmColor += (frontArea * vetaPenalty);
    } else {
        area18mmWhite += frontArea;
    }

    // ESTRUCTURA (puede de ser de 15mm o 18mm)
    let structuralArea = 0;

    if (req.module === 'bajo_mesada') {
        const sides = 2 * (h * d);
        const bottom = w * d;
        const topStrips = 2 * (w * 0.1);
        const estantes = shelfCount * (w * d); // Sumamos estantes al bajo mesada
        structuralArea = sides + bottom + topStrips + estantes;
    }
    else if (req.module === 'cajonera') {
        const drawerCount = req.drawerCount ?? 3;
        const exteriorBody = 2 * (h * d) + 2 * (w * d);
        const cajones = drawerCount * (w * d * 1.5);
        structuralArea = exteriorBody + cajones;
        area3mm += drawerCount * (w * d);
    }
    else if (req.module === 'alacena') {
        const exteriorBody = 2 * (h * d) + 2 * (w * d);
        const estantes = shelfCount * (w * d);
        structuralArea = exteriorBody + estantes;
    }
    else if (req.module === 'placard') {
        const placardShelfCount = req.shelfCount ?? 6; // Default placard
        shelfCount = placardShelfCount;

        // Cuerpo exterior del placard
        const exteriorBody = 2 * (h * d) + 2 * (w * d);
        const internalDivisions = 3 * (h * d);
        const estantes = placardShelfCount * (w * d);

        // Cajoneras internas (2 × body + 2 × 3 cajones)
        const cajW = PLACARD_INT_CAJONERA_W;
        const cajH = PLACARD_INT_CAJONERA_H;
        const cajD = PLACARD_INT_CAJONERA_D;
        const cajBodyArea = PLACARD_INT_CAJONERA_COUNT * (2 * (cajH * cajD) + 2 * (cajW * cajD));
        const cajDrawerArea = PLACARD_INT_CAJONERA_COUNT * PLACARD_INT_CAJONERA_DRAWERS * (cajW * cajD * 1.5);

        structuralArea = exteriorBody + internalDivisions + estantes + cajBodyArea + cajDrawerArea;

        // Fondos 3mm para cajones internos
        area3mm += PLACARD_INT_CAJONERA_COUNT * PLACARD_INT_CAJONERA_DRAWERS * (cajW * cajD);
    }

    if (req.internalThickness === '15mm') {
        area15mmWhite += structuralArea;
    } else if (req.internalThickness === '18mm_color') {
        area18mmColor += structuralArea;
    } else {
        area18mmWhite += structuralArea;
    }

    return { area18mmWhite, area15mmWhite, area18mmColor, area3mm, shelfCount, doorCount };
}

function calculateCanto(req: QuoteRequest, shelfCount: number, doorCount: number): { white: number, color: number } {
    const w = req.dimensions.width / 1000;
    const h = req.dimensions.height / 1000;
    // const d = req.dimensions.depth / 1000; // No se usa para canto frontal

    let white = 0;
    let color = 0;

    // 1. Canto de Color: Perímetro de Puertas/Frentes
    // Asumimos que el frente se divide en N puertas.
    // El perímetro total de las puertas es aproximadamente el perímetro del frente 
    // más los laterales internos de las puertas (H * 2*(doorCount-1)).
    const frontPerimeter = 2 * (w + h);
    let internalFrontEdges = 0;
    if (req.module === 'cajonera') {
        // En cajoneras, los frentes están apilados: sumamos bordes horizontales internos
        internalFrontEdges = 2 * w * (doorCount - 1);
    } else {
        // En el resto, las puertas son verticales: sumamos bordes verticales internos
        internalFrontEdges = 2 * h * (doorCount - 1);
    }
    
    if (req.frontMaterial === 'color') {
        color = frontPerimeter + internalFrontEdges;
    } else {
        // Si el frente es blanco, el canto del frente es blanco
        white += (frontPerimeter + internalFrontEdges);
    }

    // 2. Canto Blanco: Bordes de estructura y estantes
    // Bordes frontales del cuerpo (lo que se ve al abrir)
    const bodyFrontEdges = 2 * w + 2 * h;
    // Borde frontal de cada estante
    const shelvesEdges = shelfCount * w;

    white += bodyFrontEdges + shelvesEdges;

    return { white, color };
}

// ... (clampDimensions stays same)

export function calculateQuote(req: QuoteRequest): QuoteResult {
    const DIM_MIN_MM = 100;
    const DIM_MAX_MM = 4000;
    const clamp = (v: number) => Math.min(Math.max(v, DIM_MIN_MM), DIM_MAX_MM);

    const safeReq: QuoteRequest = {
        ...req,
        dimensions: {
            width: clamp(req.dimensions.width),
            height: clamp(req.dimensions.height),
            depth: clamp(req.dimensions.depth),
        }
    };

    const { area18mmWhite, area15mmWhite, area18mmColor, area3mm, shelfCount, doorCount } = calculateSurfaceArea(safeReq);
    const canto = calculateCanto(safeReq, shelfCount, doorCount);

    // Hardware Strategy
    let hardwareCost = 0;
    let hardwareBreakdown: string[] = [];
    const execution = HARDWARE_STRATEGY[safeReq.module];
    if (execution) {
        const result = execution(safeReq);
        hardwareCost = result.cost;
        hardwareBreakdown = result.breakdown;
    }

    const fondosBreakdown: string[] = ["Fondo trasero (MDF 3mm Blanco)"];
    if (safeReq.module === 'cajonera') {
        const drawerCount = safeReq.drawerCount ?? 3;
        fondosBreakdown.push(`Fondos p/ ${drawerCount} cajón(es)`);
    } else if (safeReq.module === 'placard') {
        const intTotal = PLACARD_INT_CAJONERA_COUNT * PLACARD_INT_CAJONERA_DRAWERS;
        fondosBreakdown.push(`Fondos p/ ${intTotal} cajón(es) internos (${PLACARD_INT_CAJONERA_COUNT} cajoneras)`);
    }

    // Actualizamos el request en el resultado para reflejar los estantes por defecto
    const updatedRequest = { ...safeReq, shelfCount };

    return {
        id: Date.now().toString() + Math.random().toString().slice(2, 6),
        module: safeReq.module,
        request: updatedRequest,
        estimatedM2_18mm_white: area18mmWhite,
        estimatedM2_18mm_color: area18mmColor,
        estimatedM2_15mm_white: area15mmWhite,
        estimatedM2_3mm: area3mm,
        hardwareCost,
        hardwareBreakdown,
        fondosBreakdown,
        cantoMetersWhite: canto.white,
        cantoMetersColor: canto.color,
        doorCount
    };
}

export function calculateCartTotals(modules: QuoteResult[], tenantSettings?: TenantSettings): CartTotals {
    let sum18mmWhite = 0;
    let sum18mmColor = 0;
    let sum15mmWhite = 0;
    let sum3mm = 0;
    let totalHardwareCost = 0;
    let totalCantoWhiteMeters = 0;
    let totalCantoColorMeters = 0;

    for (const mod of modules) {
        sum18mmWhite += mod.estimatedM2_18mm_white;
        sum18mmColor += mod.estimatedM2_18mm_color;
        sum15mmWhite += mod.estimatedM2_15mm_white;
        sum3mm += mod.estimatedM2_3mm;
        totalHardwareCost += mod.hardwareCost;
        totalCantoWhiteMeters += mod.cantoMetersWhite;
        totalCantoColorMeters += mod.cantoMetersColor;
    }

    const boards18mmWhite = Math.ceil((sum18mmWhite * WASTE_FACTOR_MULTIPLIER) / BOARD_SIZE_18MM_WHITE);
    const boards18mmColor = Math.ceil((sum18mmColor * WASTE_FACTOR_MULTIPLIER) / BOARD_SIZE_18MM_COLOR);
    const boards15mmWhite = Math.ceil((sum15mmWhite * WASTE_FACTOR_MULTIPLIER) / BOARD_SIZE_15MM_WHITE);
    const boards3mm = Math.ceil((sum3mm * WASTE_FACTOR_MULTIPLIER) / BOARD_SIZE_3MM);
    
    const totalCantoWhiteRolls = Math.ceil(totalCantoWhiteMeters / CANTO_ROLL_SIZE);
    const totalCantoColorRolls = Math.ceil(totalCantoColorMeters / CANTO_ROLL_SIZE);

    const margin = tenantSettings?.margin || 1.0;

    const cost18mmWhite = boards18mmWhite * getPrice('board_18mm_white', 86081);
    const cost18mmColor = boards18mmColor * getPrice('board_18mm_color', 105000);
    const cost15mmWhite = boards15mmWhite * getPrice('board_15mm_white', 73000);
    const cost3mm = boards3mm * getPrice('board_3mm', 29176);

    const totalCantoCost = (totalCantoWhiteRolls * getPrice('canto_roll_white', 12000)) + (totalCantoColorRolls * getPrice('canto_roll_color', 35000));

    const totalMaterialCost = Math.round(cost18mmWhite + cost18mmColor + cost15mmWhite + cost3mm);
    const finalHardwareCost = Math.round(totalHardwareCost);

    return {
        modules,
        materials: {
            boards18mmWhite,
            boards18mmColor,
            boards15mmWhite,
            boards3mm,
            cost18mmWhite: Math.round(cost18mmWhite),
            cost18mmColor: Math.round(cost18mmColor),
            cost15mmWhite: Math.round(cost15mmWhite),
            cost3mm: Math.round(cost3mm),
            totalMaterialCost
        },
        totalHardwareCost: finalHardwareCost,
        totalCantoWhiteMeters,
        totalCantoColorMeters,
        totalCantoWhiteRolls,
        totalCantoColorRolls,
        totalCantoCost: Math.round(totalCantoCost),
        grandTotal: Math.round((totalMaterialCost + finalHardwareCost + totalCantoCost) * margin)
    };
}

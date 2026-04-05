import { QuoteRequest, QuoteResult, CartTotals, MaterialRequirements } from "./types";

// Board Physical Sizes (in m2)
const BOARD_SIZE_18MM_WHITE = 5.03;
const BOARD_SIZE_18MM_COLOR = 5.03;
const BOARD_SIZE_15MM_WHITE = 5.03;
const BOARD_SIZE_3MM = 4.75;

// Board Prices (Whole board cost)
const BOARD_PRICE_18MM_WHITE = 86081;
const BOARD_PRICE_18MM_COLOR = 105000;
const BOARD_PRICE_15MM_WHITE = 73000;
const BOARD_PRICE_3MM = 29176;

// Canto Prices (Price per linear meter)
const CANTO_PRICE_WHITE = 240; // $12.000 / 50m
const CANTO_PRICE_COLOR = 700; // $35.000 / 50m

const WASTE_FACTOR_MULTIPLIER = 1.20; // +20% desperdicio (cortes, vetas, descartes)

// Cajoneras internas default para Placard (2 unidades)
const PLACARD_INT_CAJONERA_COUNT = 2;
const PLACARD_INT_CAJONERA_DRAWERS = 3;       // cajones por cajonera
const PLACARD_INT_CAJONERA_W = 500 / 1000;    // 500mm → m
const PLACARD_INT_CAJONERA_H = 600 / 1000;    // 600mm → m
const PLACARD_INT_CAJONERA_D = 500 / 1000;    // 500mm → m (profundidad interna)

// Hardware Strategy Pattern dictionary
const HARDWARE_STRATEGY: Record<string, (req: QuoteRequest) => { cost: number, breakdown: string[] }> = {
    'bajo_mesada': (req) => {
        const tier = req.hardwareTier || 'premium';
        let cost = 0;
        let breakdown: string[] = [];
        if (tier === 'standard') {
            cost = 4000;
            breakdown = ["4 Bisagras comunes + Tiradores plásticos"];
        } else if (tier === 'luxury') {
            cost = 28000;
            breakdown = ["4 Bisagras Hettich Cierre Suave + Perfil Gola"];
        } else {
            cost = 10800; // Premium
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
            unitCost = 4000;
            desc = "Guías Z Económicas";
        } else if (tier === 'luxury') {
            unitCost = 40000;
            desc = "Guías Ocultas / Tandembox";
        } else {
            // premium
            unitCost = 10368;
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
            cost = 4000;
            breakdown = ["4 Bisagras comunes + Tiradores plásticos"];
        } else if (tier === 'luxury') {
            cost = 28000;
            breakdown = ["4 Bisagras Hettich Cierre Suave + Puertas sin tirador (Push)"];
        } else {
            cost = 10800;
            breakdown = ["4 Bisagras Eurohard Cierre Suave + Perfil Aluminio"];
        }
        return { cost, breakdown };
    },
    'placard': (req) => {
        const tier = req.hardwareTier || 'premium';
        let drawerUnitCost = 0;
        let drawerDesc = "";

        if (tier === 'standard') {
            drawerUnitCost = 4000;
            drawerDesc = "Guías Z Económicas";
        } else if (tier === 'luxury') {
            drawerUnitCost = 40000;
            drawerDesc = "Guías Ocultas / Tandembox";
        } else {
            drawerUnitCost = 10368;
            drawerDesc = "Telescópicas Cierre Suave Zinc";
        }

        let sysCost = 0;
        let sysDesc = "";
        if (tier === 'standard') {
            sysCost = 50000;
            sysDesc = "Kit corredizo económico plástico";
        } else if (tier === 'luxury') {
            sysCost = 350000;
            sysDesc = "Kit corredizo Ducasse Premium C/Suave";
        } else {
            sysCost = 150000;
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

    const doorCount = getDoorCount(req.dimensions.width);

    // Fondo trasero exterior
    area3mm += (h * w);

    // FRENTES: Siempre 18mm, definidos por el color
    const frontArea = (h * w);
    const useColor = req.frontMaterial === 'color';
    if (useColor) {
        area18mmColor += frontArea;
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
    const internalDoorEdges = 2 * h * (doorCount - 1);
    
    if (req.frontMaterial === 'color') {
        color = frontPerimeter + internalDoorEdges;
    } else {
        // Si el frente es blanco, el canto del frente es blanco
        white += (frontPerimeter + internalDoorEdges);
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

export function calculateCartTotals(modules: QuoteResult[]): CartTotals {
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

    const cost18mmWhite = boards18mmWhite * BOARD_PRICE_18MM_WHITE;
    const cost18mmColor = boards18mmColor * BOARD_PRICE_18MM_COLOR;
    const cost15mmWhite = boards15mmWhite * BOARD_PRICE_15MM_WHITE;
    const cost3mm = boards3mm * BOARD_PRICE_3MM;

    const totalCantoCost = (totalCantoWhiteMeters * CANTO_PRICE_WHITE) + (totalCantoColorMeters * CANTO_PRICE_COLOR);

    const totalMaterialCost = Math.round(cost18mmWhite + cost18mmColor + cost15mmWhite + cost3mm);

    return {
        modules,
        materials: {
            boards18mmWhite,
            boards18mmColor,
            boards15mmWhite,
            boards3mm,
            cost18mmWhite,
            cost18mmColor,
            cost15mmWhite,
            cost3mm,
            totalMaterialCost
        },
        totalHardwareCost: Math.round(totalHardwareCost),
        totalCantoWhiteMeters,
        totalCantoColorMeters,
        totalCantoCost: Math.round(totalCantoCost),
        grandTotal: Math.round(totalMaterialCost + totalHardwareCost + totalCantoCost)
    };
}

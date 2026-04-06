import { z } from "zod";

export const QuoteRequestSchema = z.object({
    module: z.enum(["bajo_mesada", "alacena", "placard", "cajonera"]),
    dimensions: z.object({
        width: z.number().min(1).max(10000),
        height: z.number().min(1).max(10000),
        depth: z.number().min(1).max(10000),
    }),
    dimensionsAssumed: z.boolean().optional(),
    drawerCount: z.number().min(0).max(20).optional(),
    shelfCount: z.number().min(0).max(50).optional(),
    frontMaterial: z.enum(["blanco", "color"]).optional(),
    hardwareTier: z.enum(["standard", "premium", "luxury"]).optional(),
    internalThickness: z.enum(["18mm", "15mm"]).optional(),
});

export type ModuleType = "bajo_mesada" | "alacena" | "placard" | "cajonera";

export interface Dimensions {
    width: number;  // in mm
    height: number; // in mm
    depth: number;  // in mm
}

export interface QuoteRequest {
    module: ModuleType;
    dimensions: {
        width: number;
        height: number;
        depth: number;
    };
    dimensionsAssumed?: boolean;
    drawerCount?: number;
    shelfCount?: number;
    frontMaterial?: "blanco" | "color";
    hardwareTier?: "standard" | "premium" | "luxury";
    internalThickness?: "18mm" | "15mm";
}

export interface QuoteResult {
    id: string;
    module: ModuleType;
    request?: QuoteRequest;
    estimatedM2_18mm_white: number;
    estimatedM2_18mm_color: number;
    estimatedM2_15mm_white: number;
    estimatedM2_3mm: number;
    hardwareCost: number;
    hardwareBreakdown?: string[];
    fondosBreakdown?: string[];
    // Nuevas métricas
    cantoMetersWhite: number;
    cantoMetersColor: number;
    doorCount: number;
}

export interface MaterialRequirements {
    boards18mmWhite: number;
    cost18mmWhite: number;
    boards18mmColor: number;
    cost18mmColor: number;
    boards15mmWhite: number;
    cost15mmWhite: number;
    boards3mm: number;
    cost3mm: number;
    totalMaterialCost: number;
}

export interface CartTotals {
    modules: QuoteResult[];
    materials: MaterialRequirements;
    totalHardwareCost: number;
    totalCantoWhiteMeters: number;
    totalCantoColorMeters: number;
    totalCantoWhiteRolls: number;
    totalCantoColorRolls: number;
    totalCantoCost: number;
    grandTotal: number;
}

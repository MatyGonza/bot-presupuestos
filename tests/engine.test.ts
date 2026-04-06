import { calculateQuote } from '../src/engine/pricing';
import { QuoteRequest } from '../src/engine/types';

describe('Pricing Engine', () => {
    it('should calculate the quote for a bajo_mesada correctly with default shelf and canto', () => {
        const request: QuoteRequest = {
            module: 'bajo_mesada',
            dimensions: {
                width: 1000,  // 1 meter
                height: 800,  // 0.8 meters
                depth: 600    // 0.6 meters
            },
            frontMaterial: 'blanco',
            internalThickness: '18mm'
        };

        const result = calculateQuote(request);

        // Verification of defaults and dimensions
        expect(result.module).toBe('bajo_mesada');
        expect(result.request!.shelfCount).toBe(1); // Default shelf added
        expect(result.doorCount).toBe(2); // 1000mm width -> 2 doors

        // Area Calculation (Structural = 2*H*D + W*D + 2*W*0.1 + 1*W*D)
        // Area = 2*0.8*0.6 + 1.0*0.6 + 2*1.0*0.1 + 1*1.0*0.6
        // Area = 0.96 + 0.60 + 0.20 + 0.60 = 2.36 m2
        // Front = 0.8 * 1.0 = 0.8 m2 (White)
        // Total 18mm White = 2.36 + 0.8 = 3.16 m2
        expect(result.estimatedM2_18mm_white).toBeCloseTo(3.16, 2);

        // Canto Calculation (Front perimeter + 1 shelf edge + internal door edge)
        // Color = 0 (White front)
        // White = (2*(1.0 + 0.8) + 2*0.8*(2-1)) [front] + (2*1.0 + 2*0.8) [body] + (1*1.0) [shelf]
        // White = (3.6 + 1.6) + (2.0 + 1.6) + 1.0 = 5.2 + 3.6 + 1.0 = 9.8 meters
        expect(result.cantoMetersWhite).toBeCloseTo(9.8, 1);
        expect(result.cantoMetersColor).toBe(0);
    });
});

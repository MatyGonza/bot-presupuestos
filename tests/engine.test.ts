import { calculateQuote } from '../src/engine/pricing';
import { QuoteRequest } from '../src/engine/types';

describe('Pricing Engine', () => {
    it('should calculate the quote for a bajo_mesada correctly', () => {
        // Arrange
        const request: QuoteRequest = {
            module: 'bajo_mesada',
            dimensions: {
                width: 1000,  // 1 meter
                height: 800,  // 0.8 meters
                depth: 600    // 0.6 meters
            }
        };

        // m2 = (2 sides * 0.8*0.6) + (1 bottom * 1.0*0.6) + (2 top strips * 1.0*0.1)
        // m2 = 0.96 + 0.60 + 0.20 = 1.76 m2
        // materialBase = 1.76 * 16000 = 28160
        // waste (20%) = 5632 -> total material = 33792
        // hardware = 10000 (fixed for bajo_mesada)
        // total = 43792

        // Act
        const result = calculateQuote(request);

        // Assert
        expect(result.module).toBe('bajo_mesada');
        expect(result.estimatedM2).toBeCloseTo(1.76, 2);
        expect(result.materialCost).toBeCloseTo(28160, 2);
        expect(result.wasteFactorCost).toBeCloseTo(5632, 2);
        expect(result.hardwareCost).toBe(10000);
        expect(result.totalCost).toBeCloseTo(43792, 2);
    });
});

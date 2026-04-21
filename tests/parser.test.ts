import { parseAudioToQuote } from '../src/nlu/parser';

process.env.GEMINI_API_KEY = "jest-test-key";

// Mock the Google Generative AI SDK
jest.mock('@google/generative-ai', () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => {
      return {
        getGenerativeModel: jest.fn().mockReturnValue({
          generateContent: jest.fn().mockResolvedValue({
            response: {
              text: () => JSON.stringify([{
                module: "bajo_mesada",
                dimensions: { width: 1200, height: 800, depth: 600 }
              }])
            }
          })
        })
      };
    })
  };
});

describe('NLU Parser', () => {
    it('should parse an audio buffer into a valid QuoteRequest', async () => {
        // Arrange
        const mockAudioBuffer = Buffer.from('mock-audio-data');
        const mockMimeType = 'audio/ogg';
        const dummyApiKey = 'test-key';

        // Act
        const result = await parseAudioToQuote(mockAudioBuffer, mockMimeType, dummyApiKey);

        // Assert
        expect(result[0].module).toBe('bajo_mesada');
        expect(result[0].dimensions.width).toBe(1200);
        expect(result[0].dimensions.height).toBe(800);
        expect(result[0].dimensions.depth).toBe(600);
    });
});

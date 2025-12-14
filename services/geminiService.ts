import { GoogleGenAI } from "@google/genai";

const getAiClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key not found");
  return new GoogleGenAI({ apiKey });
};

// Helper to convert blob/url to base64
export const urlToBase64 = async (url: string): Promise<string> => {
  const response = await fetch(url);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      // Remove data url prefix (e.g., "data:image/jpeg;base64,")
      resolve(base64String.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Retry wrapper to handle Rate Limits (429) - Configured for strict quotas
async function callWithRetry<T>(operation: () => Promise<T>, retries = 5, delay = 5000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const errString = JSON.stringify(error, Object.getOwnPropertyNames(error)).toLowerCase();
    
    // Check for 429 (Too Many Requests), 503 (Service Unavailable), or quota messages
    const isRateLimit = 
      error.status === 429 || 
      error.code === 429 ||
      errString.includes('429') || 
      errString.includes('quota') || 
      errString.includes('resource exhausted') ||
      errString.includes('too many requests');

    const isServerOverload = error.status === 503 || errString.includes('503');

    if (retries > 0 && (isRateLimit || isServerOverload)) {
      console.warn(`Rate limit hit (429/Quota). Retrying in ${delay/1000}s... (${retries} retries left)`);
      
      // Wait for the delay
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Exponential backoff with a higher multiplier (2.5x) to clear minute-based quotas
      return callWithRetry(operation, retries - 1, delay * 2.5); 
    }
    throw error;
  }
}

export const removeBackground = async (imageUrl: string): Promise<string> => {
  return callWithRetry(async () => {
    const ai = getAiClient();
    const base64Data = await urlToBase64(imageUrl);

    const model = "gemini-2.5-flash-image";
    const prompt = "Remove the background from this image. Return ONLY the object with a white or transparent background. Keep the main subject intact.";

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Data,
            },
          },
          { text: prompt },
        ],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
    
    throw new Error("No image returned from AI");
  });
};

export const enhanceImage = async (imageUrl: string): Promise<string> => {
  return callWithRetry(async () => {
    const ai = getAiClient();
    const base64Data = await urlToBase64(imageUrl);

    const model = "gemini-2.5-flash-image";
    const prompt = "Enhance the sharpness, clarity, and lighting of this image. Make it look professional and high quality. Return the enhanced image.";

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Data,
            },
          },
          { text: prompt },
        ],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
    
    throw new Error("No image returned from AI");
  });
};

export const magicEraser = async (compositeImageUrl: string): Promise<string> => {
  return callWithRetry(async () => {
    const ai = getAiClient();
    const base64Data = await urlToBase64(compositeImageUrl);

    const model = "gemini-2.5-flash-image";
    const prompt = "The areas marked with translucent RED color in this image indicate objects to be removed. Remove the red markings and the objects beneath them. Fill the erased area naturally to match the surrounding background texture and lighting. Return the clean, edited image.";

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Data,
            },
          },
          { text: prompt },
        ],
      },
    });

    const parts = response.candidates?.[0]?.content?.parts;
    if (parts) {
      for (const part of parts) {
        if (part.inlineData && part.inlineData.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
    }
    
    throw new Error("No image returned from AI");
  });
};

export const identifyPageNumber = async (imageUrl: string): Promise<number> => {
  return callWithRetry(async () => {
    const ai = getAiClient();
    const base64Data = await urlToBase64(imageUrl);

    // Use gemini-2.5-flash for multimodal reasoning (image + text prompt)
    const model = "gemini-2.5-flash";
    const prompt = "Identify the page number visible in this document image. Return ONLY the number as an integer. If no page number is clearly visible or found, return -1.";

    const response = await ai.models.generateContent({
      model: model,
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg", 
              data: base64Data,
            },
          },
          { text: prompt },
        ],
      },
    });

    const text = response.text;
    if (!text) return -1;
    
    // Extract number from text
    const match = text.match(/-?\d+/);
    if (match) {
        return parseInt(match[0], 10);
    }
    
    return -1;
  });
};
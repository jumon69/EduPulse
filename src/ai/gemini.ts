import { GoogleGenAI, Type } from "@google/genai";

/**
 * Service to handle AI interactions for the HSC MCQ Genie.
 * Modularizes generation of summaries and questions.
 */

const apiKey = (process.env as any).GEMINI_API_KEY;

export const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

export interface GeneratedContent {
  summary: string;
  questions: {
    id: string;
    question: string;
    options: string[];
    correctIdx: number;
    explanation: string;
  }[];
}

export async function analyzeMaterial(text: string): Promise<GeneratedContent> {
  const customKey = localStorage.getItem('hsc_gemini_api_key');
  const activeAi = customKey ? new GoogleGenAI({ apiKey: customKey }) : ai;

  if (!activeAi) {
    throw new Error("GEMINI_API_KEY is not configured. AI features are unavailable.");
  }

  const response = await activeAi.models.generateContent({ 
    model: "gemini-1.5-flash", 
    contents: `Analyze the following HSC study material/question paper. Your goal is to be EXHAUSTIVE and extract or generate EVERY possible MCQ from this text.
    
    CRITICAL INSTRUCTIONS:
    1. All generated/extracted text MUST be in Bengali (Bangla) script.
    2. Format precisely as JSON.
    3. Include 4 options per question.
    4. Provide the correct index (0-3) and a short explanation.
    5. Output as many questions as the text supports (no upper limit).
    
    Material Content:
    ${text}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING } 
                },
                correctIdx: { type: Type.NUMBER },
                explanation: { type: Type.STRING }
              },
              required: ["question", "options", "correctIdx", "explanation"]
            }
          }
        },
        required: ["summary", "questions"]
      }
    }
  });

  try {
    const output = response.text;
    if (!output) throw new Error("AI returned empty response");
    const result = JSON.parse(output);
    return result as GeneratedContent;
  } catch (err) {
    console.error("Failed to parse Gemini response. Response object:", response);
    throw new Error("AI রেসপন্স প্রসেস করতে সমস্যা হয়েছে। আবার চেষ্টা করুন।");
  }
}

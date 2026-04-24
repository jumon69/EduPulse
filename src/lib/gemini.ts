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
    model: "gemini-3-flash-preview",
    contents: `Analyze the following HSC study material/question paper. Your goal is to be EXHAUSTIVE and extract or generate EVERY possible MCQ from this text.
    
    CRITICAL INSTRUCTIONS:
    1. All generated/extracted text MUST be in Bengali (Bangla) script.
    2. If the text already contains Multiple Choice Questions (MCQs), EXTRACT THEM ALL exactly as they are. 
    3. If the text is study material, generate a question for every single concept, fact, or definition.
    4. DO NOT SUMMARIZE or SKIP any part of the text. I need absolute coverage.
    5. Output as many questions as the text supports (no upper limit per chunk).
    
    Material Content:
    ${text.substring(0, 10000)}`,
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
                id: { type: Type.STRING },
                question: { type: Type.STRING },
                options: { 
                  type: Type.ARRAY, 
                  items: { type: Type.STRING }
                },
                correctIdx: { type: Type.INTEGER },
                explanation: { type: Type.STRING }
              },
              required: ["id", "question", "options", "correctIdx", "explanation"]
            }
          }
        },
        required: ["summary", "questions"]
      }
    }
  });

  try {
    const result = JSON.parse(response.text);
    return result as GeneratedContent;
  } catch (err) {
    console.error("Failed to parse Gemini response:", response.text);
    throw new Error("The AI returned an invalid format. Please try again.");
  }
}

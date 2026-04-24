/**
 * Utility functions for handling PDF text and file names.
 */

export function cleanExtractedText(text: string): string {
  if (!text) return "";
  
  // Remove excessive whitespace and page numbers/headers if easily detectable
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n\s*\n/g, "\n\n")
    .trim();
}

export function getFileNameWithoutExtension(fileName: string): string {
  return fileName.replace(/\.[^/.]+$/, "");
}

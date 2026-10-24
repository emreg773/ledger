// Constants shared by the backend and the frontend.
// Must stay free of server imports: the browser bundle imports this file.

// Languages the owner can pick. Any BCP-47 code works in the backend;
// unknown codes are passed to the model as-is.
export const LANGUAGES = [
  { code: "es", label: "Español", englishName: "Spanish" },
  { code: "en", label: "English", englishName: "English" },
  { code: "zh", label: "中文", englishName: "Simplified Chinese" },
  { code: "vi", label: "Tiếng Việt", englishName: "Vietnamese" },
  { code: "tr", label: "Türkçe", englishName: "Turkish" },
  { code: "ko", label: "한국어", englishName: "Korean" },
] as const;

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.englishName ?? code;
}

// Arrival messages start with this marker so the UI can show a document card.
export const documentMarker = (documentId: string) => `[document:${documentId}]`;
export const DOCUMENT_MARKER = /\[document:([a-z0-9]+)\]/;

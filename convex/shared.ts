// Constants shared by the backend and the frontend.
// Must stay free of server imports: the browser bundle imports this file.

// Languages the owner can pick. Any BCP-47 code works in the backend;
// unknown codes are passed to the model as-is.
export const LANGUAGES = [
  { code: "es", label: "Español", englishName: "Spanish" },
  { code: "en", label: "English", englishName: "English" },
  { code: "zh", label: "中文", englishName: "Simplified Chinese" },
  { code: "vi", label: "Tiếng Việt", englishName: "Vietnamese" },
  { code: "ko", label: "한국어", englishName: "Korean" },
  { code: "tr", label: "Türkçe", englishName: "Turkish" },
] as const;

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.englishName ?? code;
}

// Arrival messages start with this marker so the UI can show a document card.
export const documentMarker = (documentId: string) => `[document:${documentId}]`;
export const DOCUMENT_MARKER = /\[document:([a-z0-9]+)\]/;

// The agent puts this on its own line to place an action card (Track B renders it).
export const actionMarker = (actionId: string) => `[action:${actionId}]`;

// Notes from the server to the agent (e.g. "the payment ran"). Saved as user
// messages so the model reads them in order; the chat UI hides them.
export const SYSTEM_NOTE_PREFIX = "[system-note]";

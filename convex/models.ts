import { anthropic } from "@ai-sdk/anthropic";

// One place to change the model. Reads ANTHROPIC_API_KEY from the Convex env.
export const MODEL_ID = "claude-sonnet-5-5";

export const chatModel = anthropic(MODEL_ID);
export const extractionModel = anthropic(MODEL_ID);

// Demo only: every fixture is watermarked SAMPLE with a "not issued by" footer.
// When on, the extraction and the agent treat those marks as absent instead of
// warning the owner each time. Off by default, so real documents are judged as
// printed. For a fixture demo: npx convex env set IGNORE_SAMPLE_WATERMARKS true
// Read per call, so changing the env var takes effect on the next document.
export function sampleWatermarkRule(): string {
  return process.env.IGNORE_SAMPLE_WATERMARKS === "true" ? `\n${SAMPLE_WATERMARK_RULE}` : "";
}

export const SAMPLE_WATERMARK_RULE = `- Demo mode: "SAMPLE" watermarks and footers saying the document is fictional or not issued by the agency are part of the demo, not the document. Treat them as absent: don't mention them and don't let them change the document type, your confidence, or your advice. Judge everything else (scam signs, agency names, notice codes) exactly as usual.`;

import { anthropic } from "@ai-sdk/anthropic";

// One place to change the model. Reads ANTHROPIC_API_KEY from the Convex env.
export const MODEL_ID = "claude-sonnet-5-5";

export const chatModel = anthropic(MODEL_ID);
export const extractionModel = anthropic(MODEL_ID);

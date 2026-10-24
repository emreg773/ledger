import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";
import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";

const app = defineApp();
// The Agent component stores threads and messages in its own tables.
app.use(agent);
// Upload, chat and daily agent-run limits (convex/limits.ts).
app.use(rateLimiter);

export default app;

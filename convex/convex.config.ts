import { defineApp } from "convex/server";
import agent from "@convex-dev/agent/convex.config";

const app = defineApp();
// The Agent component stores threads and messages in its own tables.
app.use(agent);

export default app;

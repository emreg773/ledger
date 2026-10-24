import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Uploads that were refused (type, size, rate limit) or never ingested.
crons.interval("delete unused uploads", { hours: 1 }, internal.admin.cleanupOrphanUploads, {});

export default crons;

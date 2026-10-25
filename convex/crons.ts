import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Uploads that were refused (type, size, rate limit) or never ingested.
crons.interval("delete unused uploads", { hours: 1 }, internal.admin.cleanupOrphanUploads, {});

// Connected Google Calendars, so new and changed events show up within the hour.
crons.interval("sync google calendars", { hours: 1 }, internal.googleCalendar.syncAll, {});

// Telegram nudges for every linked owner, by each owner's demo clock (nudges.ts).
crons.interval("telegram nudges", { hours: 1 }, internal.nudges.runDueAll, {});

export default crons;

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Uploads that were refused (type, size, rate limit) or never ingested.
crons.interval("delete unused uploads", { hours: 1 }, internal.admin.cleanupOrphanUploads, {});

// Connected Google Calendars, so new and changed events show up within the hour.
crons.interval("sync google calendars", { hours: 1 }, internal.googleCalendar.syncAll, {});

// Deadline reminders for every owner, by each owner's demo clock (deadlines.ts).
crons.interval("deadline reminders", { hours: 1 }, internal.deadlines.runDueAll, {});

export default crons;

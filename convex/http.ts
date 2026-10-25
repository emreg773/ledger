import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { callback as calendarCallback } from "./googleCalendar";

// Convex Auth's OAuth routes (/api/auth/...). Google's redirect URI is
// https://<deployment>.convex.site/api/auth/callback/google
const http = httpRouter();
auth.addHttpRoutes(http);

// Google Calendar connect (googleCalendar.ts). Redirect URI:
// https://<deployment>.convex.site/calendar/callback
http.route({ path: "/calendar/callback", method: "GET", handler: calendarCallback });

export default http;

import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { callback as calendarCallback } from "./googleCalendar";
import { callback as gmailCallback } from "./gmail";

// Convex Auth's OAuth routes (/api/auth/...). Google's redirect URI is
// https://<deployment>.convex.site/api/auth/callback/google
const http = httpRouter();
auth.addHttpRoutes(http);

// Google Calendar connect (googleCalendar.ts). Redirect URI:
// https://<deployment>.convex.site/calendar/callback
http.route({ path: "/calendar/callback", method: "GET", handler: calendarCallback });

// Gmail connect (gmail.ts). Redirect URI: https://<deployment>.convex.site/gmail/callback
http.route({ path: "/gmail/callback", method: "GET", handler: gmailCallback });

export default http;

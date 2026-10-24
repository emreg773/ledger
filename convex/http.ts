import { httpRouter } from "convex/server";
import { auth } from "./auth";

// Convex Auth's OAuth routes (/api/auth/...). Google's redirect URI is
// https://<deployment>.convex.site/api/auth/callback/google
const http = httpRouter();
auth.addHttpRoutes(http);

export default http;

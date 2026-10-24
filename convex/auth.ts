import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

// Google sign-in (Step 3 brief, Section 3). Reads AUTH_GOOGLE_ID and
// AUTH_GOOGLE_SECRET from the Convex env; SITE_URL is where Google sends users back.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
});

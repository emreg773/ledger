import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { RecentEvent } from "@/lib/contract";

// Track A's Step 3 functions (docs/ledger-step3-B.md, Section 7), typed by hand
// so the UI builds before those functions exist in convex/_generated/api.
// The owner always comes from the session, so nothing here takes an ownerId.
// Once Track A's stubs are merged, these can be swapped for `api.*` one by one.

const query = <Args extends Record<string, unknown>, Return>(name: string) =>
  makeFunctionReference<"query", Args, Return>(name);
const mutation = <Args extends Record<string, unknown>, Return>(name: string) =>
  makeFunctionReference<"mutation", Args, Return>(name);

type Empty = Record<string, never>;

export type PushSubscriptionArgs = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

export const backend = {
  owners: {
    me: query<Empty, Doc<"owners"> | null>("owners:me"),
    completeOnboarding: mutation<
      { name: string; businessName: string; preferredLanguage: string; city?: string },
      Id<"owners">
    >("owners:completeOnboarding"),
    setLanguage: mutation<{ language: string }, null>("owners:setLanguage"),
    resetMyData: mutation<Empty, null>("owners:resetMyData"),
    deleteMyAccount: mutation<Empty, null>("owners:deleteMyAccount"),
  },
  documents: {
    generateUploadUrl: mutation<Empty, string>("documents:generateUploadUrl"),
    listForOwner: query<Empty, (Doc<"documents"> & { url: string | null })[]>(
      "documents:listForOwner",
    ),
  },
  intake: {
    ingestWebUpload: mutation<{ storageId: Id<"_storage">; mimeType: string }, unknown>(
      "intake:ingestWebUpload",
    ),
  },
  chat: {
    sendMessage: mutation<{ text: string }, null>("chat:sendMessage"),
  },
  events: {
    listRecentForOwner: query<{ sinceMs?: number; limit?: number }, RecentEvent[]>(
      "events:listRecentForOwner",
    ),
  },
  cases: {
    listForOwner: query<Empty, Doc<"cases">[]>("cases:listForOwner"),
  },
  push: {
    saveSubscription: mutation<PushSubscriptionArgs, null>("push:saveSubscription"),
    removeSubscription: mutation<{ endpoint: string }, null>("push:removeSubscription"),
    mySubscriptionCount: query<Empty, number>("push:mySubscriptionCount"),
    sendTest: mutation<Empty, null>("push:sendTest"),
  },
};

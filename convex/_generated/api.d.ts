/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as actions from "../actions.js";
import type * as admin from "../admin.js";
import type * as agent from "../agent.js";
import type * as auth from "../auth.js";
import type * as calendarCompliance from "../calendarCompliance.js";
import type * as calendarRules from "../calendarRules.js";
import type * as cases from "../cases.js";
import type * as chat from "../chat.js";
import type * as clock from "../clock.js";
import type * as crons from "../crons.js";
import type * as deadlines from "../deadlines.js";
import type * as digest from "../digest.js";
import type * as documents from "../documents.js";
import type * as events from "../events.js";
import type * as extraction from "../extraction.js";
import type * as generalDates from "../generalDates.js";
import type * as googleCalendar from "../googleCalendar.js";
import type * as googleOAuth from "../googleOAuth.js";
import type * as http from "../http.js";
import type * as intake from "../intake.js";
import type * as limits from "../limits.js";
import type * as models from "../models.js";
import type * as nessie from "../nessie.js";
import type * as notifications from "../notifications.js";
import type * as officialContacts from "../officialContacts.js";
import type * as owners from "../owners.js";
import type * as playbooks_countyHealthInspection from "../playbooks/countyHealthInspection.js";
import type * as playbooks_index from "../playbooks/index.js";
import type * as playbooks_irs972cg from "../playbooks/irs972cg.js";
import type * as playbooks_irsCp14 from "../playbooks/irsCp14.js";
import type * as playbooks_irsCp504 from "../playbooks/irsCp504.js";
import type * as push from "../push.js";
import type * as pushNode from "../pushNode.js";
import type * as senderCheck from "../senderCheck.js";
import type * as shared from "../shared.js";
import type * as telegram from "../telegram.js";
import type * as testing from "../testing.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  actions: typeof actions;
  admin: typeof admin;
  agent: typeof agent;
  auth: typeof auth;
  calendarCompliance: typeof calendarCompliance;
  calendarRules: typeof calendarRules;
  cases: typeof cases;
  chat: typeof chat;
  clock: typeof clock;
  crons: typeof crons;
  deadlines: typeof deadlines;
  digest: typeof digest;
  documents: typeof documents;
  events: typeof events;
  extraction: typeof extraction;
  generalDates: typeof generalDates;
  googleCalendar: typeof googleCalendar;
  googleOAuth: typeof googleOAuth;
  http: typeof http;
  intake: typeof intake;
  limits: typeof limits;
  models: typeof models;
  nessie: typeof nessie;
  notifications: typeof notifications;
  officialContacts: typeof officialContacts;
  owners: typeof owners;
  "playbooks/countyHealthInspection": typeof playbooks_countyHealthInspection;
  "playbooks/index": typeof playbooks_index;
  "playbooks/irs972cg": typeof playbooks_irs972cg;
  "playbooks/irsCp14": typeof playbooks_irsCp14;
  "playbooks/irsCp504": typeof playbooks_irsCp504;
  push: typeof push;
  pushNode: typeof pushNode;
  senderCheck: typeof senderCheck;
  shared: typeof shared;
  telegram: typeof telegram;
  testing: typeof testing;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};

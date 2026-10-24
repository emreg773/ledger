/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions from "../actions.js";
import type * as agent from "../agent.js";
import type * as chat from "../chat.js";
import type * as documents from "../documents.js";
import type * as events from "../events.js";
import type * as extraction from "../extraction.js";
import type * as intake from "../intake.js";
import type * as models from "../models.js";
import type * as owners from "../owners.js";
import type * as shared from "../shared.js";
import type * as testing from "../testing.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  actions: typeof actions;
  agent: typeof agent;
  chat: typeof chat;
  documents: typeof documents;
  events: typeof events;
  extraction: typeof extraction;
  intake: typeof intake;
  models: typeof models;
  owners: typeof owners;
  shared: typeof shared;
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
};

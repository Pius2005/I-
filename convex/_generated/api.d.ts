/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as applications from "../applications.js";
import type * as audit from "../audit.js";
import type * as auditData from "../auditData.js";
import type * as auditQueries from "../auditQueries.js";
import type * as auditWrites from "../auditWrites.js";
import type * as auth from "../auth.js";
import type * as candidate from "../candidate.js";
import type * as crons from "../crons.js";
import type * as extract from "../extract.js";
import type * as files from "../files.js";
import type * as interviews from "../interviews.js";
import type * as notifications from "../notifications.js";
import type * as public_ from "../public.js";
import type * as recruiter from "../recruiter.js";
import type * as reminders from "../reminders.js";
import type * as secure from "../secure.js";
import type * as secureData from "../secureData.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  applications: typeof applications;
  audit: typeof audit;
  auditData: typeof auditData;
  auditQueries: typeof auditQueries;
  auditWrites: typeof auditWrites;
  auth: typeof auth;
  candidate: typeof candidate;
  crons: typeof crons;
  extract: typeof extract;
  files: typeof files;
  interviews: typeof interviews;
  notifications: typeof notifications;
  public: typeof public_;
  recruiter: typeof recruiter;
  reminders: typeof reminders;
  secure: typeof secure;
  secureData: typeof secureData;
  seed: typeof seed;
  settings: typeof settings;
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

export declare const components: {};

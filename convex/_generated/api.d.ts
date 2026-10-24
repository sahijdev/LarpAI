/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as pipeline from "../pipeline.js";
import type * as reports from "../reports.js";
import type * as steps_comparison from "../steps/comparison.js";
import type * as steps_images from "../steps/images.js";
import type * as steps_price from "../steps/price.js";
import type * as steps_reviews from "../steps/reviews.js";
import type * as steps_util from "../steps/util.js";
import type * as steps_verdict from "../steps/verdict.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  pipeline: typeof pipeline;
  reports: typeof reports;
  "steps/comparison": typeof steps_comparison;
  "steps/images": typeof steps_images;
  "steps/price": typeof steps_price;
  "steps/reviews": typeof steps_reviews;
  "steps/util": typeof steps_util;
  "steps/verdict": typeof steps_verdict;
  validators: typeof validators;
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

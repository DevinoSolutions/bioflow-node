/**
 * Public wire types — every alias resolves into src/generated/v1.ts, which is
 * machine-generated from packages/api/openapi/v1.json (never hand-edited).
 *
 * Forward compatibility: treat server-sent string unions (statuses, event
 * types, …) as OPEN sets — new values may appear without a major version.
 * The SDK performs no runtime narrowing of responses.
 */
import type { components, operations } from "./generated/v1";

export type { components, operations, paths } from "./generated/v1";

/** Query parameters of an operation, by operationId. */
export type QueryOf<Op extends keyof operations> = NonNullable<
  operations[Op]["parameters"]["query"]
>;

/** JSON request body of an operation, by operationId. */
export type BodyOf<Op extends keyof operations> =
  NonNullable<operations[Op]["requestBody"]> extends {
    content: { "application/json": infer B };
  }
    ? B
    : never;

type Schemas = components["schemas"];

export type Problem = Schemas["Problem"];
export type Page = Schemas["Page"];
export type PageSummary = Schemas["PageSummary"];
export type PageList = Schemas["PageList"];
export type PageBlockRef = Schemas["PageBlockRef"];
export type PublishResult = Schemas["PublishResult"];
export type CreatePageRequest = Schemas["CreatePageRequest"];
export type UpdatePageRequest = Schemas["UpdatePageRequest"];
export type AddBlockRequest = Schemas["AddBlockRequest"];
export type PublishPageRequest = Schemas["PublishPageRequest"];
export type Contact = Schemas["Contact"];
export type ContactList = Schemas["ContactList"];
/** Named FileObject to avoid clashing with the global DOM/Node File type. */
export type FileObject = Schemas["File"];
export type FileList = Schemas["FileList"];
export type AnalyticsSummary = Schemas["AnalyticsSummary"];
export type Usage = Schemas["Usage"];
export type WebhookEndpoint = Schemas["WebhookEndpoint"];
export type WebhookEndpointList = Schemas["WebhookEndpointList"];
export type CreateWebhookEndpointRequest =
  Schemas["CreateWebhookEndpointRequest"];
export type CreateWebhookEndpointResponse =
  Schemas["CreateWebhookEndpointResponse"];
export type UpdateWebhookEndpointRequest =
  Schemas["UpdateWebhookEndpointRequest"];
export type WebhookDelivery = Schemas["WebhookDelivery"];
export type WebhookDeliveryList = Schemas["WebhookDeliveryList"];
export type WebhookAttempt = Schemas["WebhookAttempt"];
export type ReplayWebhooksRequest = Schemas["ReplayWebhooksRequest"];
export type WebhookReplayResult = Schemas["WebhookReplayResult"];
export type RotateWebhookSecretResponse =
  Schemas["RotateWebhookSecretResponse"];
export type WebhookTestResult = Schemas["WebhookTestResult"];

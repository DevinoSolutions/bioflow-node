import { HttpCore } from "./core/http";
import type {
  ClientOptions,
  RawResult,
  RequestInput,
  RequestOptions,
} from "./core/http";
import { Pages } from "./resources/pages";
import { Analytics, Contacts, Files, UsageResource } from "./resources/simple";
import { WebhookEndpoints } from "./resources/webhook-endpoints";
import { Webhooks } from "./webhooks";

/**
 * The BioFlow public-API client.
 *
 * ```ts
 * import BioFlow from "@bioflow/sdk";
 * const bioflow = new BioFlow({ apiKey: process.env.BIOFLOW_API_KEY! });
 * for await (const page of await bioflow.pages.list()) console.log(page.slug);
 * ```
 */
export class BioFlow {
  private readonly core: HttpCore;

  readonly pages: Pages;
  readonly contacts: Contacts;
  readonly files: Files;
  readonly analytics: Analytics;
  readonly usage: UsageResource;
  readonly webhookEndpoints: WebhookEndpoints;
  /** Signature verification for received webhooks (no API key needed). */
  readonly webhooks: Webhooks;

  constructor(options: ClientOptions) {
    this.core = new HttpCore(options);
    this.pages = new Pages(this.core);
    this.contacts = new Contacts(this.core);
    this.files = new Files(this.core);
    this.analytics = new Analytics(this.core);
    this.usage = new UsageResource(this.core);
    this.webhookEndpoints = new WebhookEndpoints(this.core);
    this.webhooks = new Webhooks();
  }

  /**
   * Raw escape hatch — same auth/retry/error pipeline as the typed methods,
   * for endpoints newer than this SDK build. Returns the parsed body plus the
   * underlying Response.
   */
  request<T = unknown>(
    input: RequestInput,
    opts?: RequestOptions,
  ): Promise<RawResult<T>> {
    return this.core.request<T>(input, opts ?? {});
  }
}

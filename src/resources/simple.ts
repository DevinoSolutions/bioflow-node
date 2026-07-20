/** The single-call resources: contacts, files, analytics, usage. */
import type { HttpCore, RequestOptions } from "../core/http";
import { fetchCursorPage, type CursorPage } from "../core/pagination";
import { SDK_OPERATIONS } from "../operations";
import type {
  AnalyticsSummary,
  Contact,
  FileObject,
  QueryOf,
  Usage,
} from "../types";

export class Contacts {
  constructor(private readonly core: HttpCore) {}

  /** GET /v1/contacts — cursor-paginated captured leads. */
  list(
    params: QueryOf<"listContacts"> = {},
    opts?: RequestOptions,
  ): Promise<CursorPage<Contact>> {
    return fetchCursorPage<Contact>(this.core, {
      path: SDK_OPERATIONS.listContacts.path,
      query: params,
      opts,
    });
  }
}

export class Files {
  constructor(private readonly core: HttpCore) {}

  /** GET /v1/files */
  list(
    params: QueryOf<"listFiles"> = {},
    opts?: RequestOptions,
  ): Promise<CursorPage<FileObject>> {
    return fetchCursorPage<FileObject>(this.core, {
      path: SDK_OPERATIONS.listFiles.path,
      query: params,
      opts,
    });
  }
}

export class Analytics {
  constructor(private readonly core: HttpCore) {}

  /** GET /v1/analytics/summary */
  async summary(
    params: QueryOf<"getAnalyticsSummary"> = {},
    opts?: RequestOptions,
  ): Promise<AnalyticsSummary> {
    const { data } = await this.core.request<AnalyticsSummary>(
      {
        method: "GET",
        path: SDK_OPERATIONS.getAnalyticsSummary.path,
        query: params,
      },
      opts,
    );
    return data;
  }
}

export class UsageResource {
  constructor(private readonly core: HttpCore) {}

  /** GET /v1/usage — free to call: never consumes quota. */
  async get(opts?: RequestOptions): Promise<Usage> {
    const { data } = await this.core.request<Usage>(
      { method: "GET", path: SDK_OPERATIONS.getUsage.path },
      opts,
    );
    return data;
  }
}

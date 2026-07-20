import type { HttpCore, RequestOptions } from "../core/http";
import { fetchCursorPage, type CursorPage } from "../core/pagination";
import { SDK_OPERATIONS } from "../operations";
import type {
  AddBlockRequest,
  CreatePageRequest,
  Page,
  PageSummary,
  PublishPageRequest,
  PublishResult,
  QueryOf,
  UpdatePageRequest,
} from "../types";

export class Pages {
  constructor(private readonly core: HttpCore) {}

  /** GET /v1/pages — cursor-paginated; `for await` walks every page. */
  list(
    params: QueryOf<"listPages"> = {},
    opts?: RequestOptions,
  ): Promise<CursorPage<PageSummary>> {
    return fetchCursorPage<PageSummary>(this.core, {
      path: SDK_OPERATIONS.listPages.path,
      query: params,
      opts,
    });
  }

  /** POST /v1/pages — creates a draft page. */
  async create(body: CreatePageRequest, opts?: RequestOptions): Promise<Page> {
    const { data } = await this.core.request<Page>(
      { method: "POST", path: SDK_OPERATIONS.createPage.path, body },
      opts,
    );
    return data;
  }

  /** GET /v1/pages/{page_id} */
  async get(pageId: string, opts?: RequestOptions): Promise<Page> {
    const { data } = await this.core.request<Page>(
      { method: "GET", path: `/v1/pages/${encodeURIComponent(pageId)}` },
      opts,
    );
    return data;
  }

  /**
   * PATCH /v1/pages/{page_id} — merge-patch of the draft. Pass the page's
   * current `updated_at` as `expected_updated_at` (optimistic concurrency);
   * a stale value yields 409 `stale_snapshot`.
   */
  async update(
    pageId: string,
    body: UpdatePageRequest,
    opts?: RequestOptions,
  ): Promise<Page> {
    const { data } = await this.core.request<Page>(
      {
        method: "PATCH",
        path: `/v1/pages/${encodeURIComponent(pageId)}`,
        body,
      },
      opts,
    );
    return data;
  }

  /** DELETE /v1/pages/{page_id} */
  async delete(pageId: string, opts?: RequestOptions): Promise<void> {
    await this.core.request<undefined>(
      { method: "DELETE", path: `/v1/pages/${encodeURIComponent(pageId)}` },
      opts,
    );
  }

  /** POST /v1/pages/{page_id}/blocks — appends a block to the draft. */
  async addBlock(
    pageId: string,
    body: AddBlockRequest,
    opts?: RequestOptions,
  ): Promise<Page> {
    const { data } = await this.core.request<Page>(
      {
        method: "POST",
        path: `/v1/pages/${encodeURIComponent(pageId)}/blocks`,
        body,
      },
      opts,
    );
    return data;
  }

  /** DELETE /v1/pages/{page_id}/blocks/{block_id} */
  async removeBlock(
    pageId: string,
    blockId: string,
    params: QueryOf<"removeBlock">,
    opts?: RequestOptions,
  ): Promise<Page> {
    const { data } = await this.core.request<Page>(
      {
        method: "DELETE",
        path: `/v1/pages/${encodeURIComponent(pageId)}/blocks/${encodeURIComponent(blockId)}`,
        query: params,
      },
      opts,
    );
    return data;
  }

  /**
   * POST /v1/pages/{page_id}/publish — immediate, or scheduled via
   * `starts_at`. Requires the `publish` scope.
   */
  async publish(
    pageId: string,
    body: PublishPageRequest = {},
    opts?: RequestOptions,
  ): Promise<PublishResult> {
    const { data } = await this.core.request<PublishResult>(
      {
        method: "POST",
        path: `/v1/pages/${encodeURIComponent(pageId)}/publish`,
        body,
      },
      opts,
    );
    return data;
  }
}

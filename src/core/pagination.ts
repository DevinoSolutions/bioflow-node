/**
 * Cursor pagination over the /v1 list envelope { data, has_more, next_cursor }
 * (open-api D2). Every list method returns a CursorPage: use `.data` for the
 * single page (escape hatch) or `for await` the page object to walk the whole
 * collection — following pages are fetched lazily with the same query.
 */
import type { HttpCore, RequestOptions } from "./http";

export interface CursorPageEnvelope<Item> {
  data: Item[];
  has_more: boolean;
  next_cursor: string | null;
}

export class CursorPage<Item> implements AsyncIterable<Item> {
  readonly data: Item[];
  readonly has_more: boolean;
  readonly next_cursor: string | null;
  readonly response: Response;
  readonly requestId: string | null;
  readonly #fetchAfter: (after: string) => Promise<CursorPage<Item>>;

  constructor(
    envelope: CursorPageEnvelope<Item>,
    meta: { response: Response; requestId: string | null },
    fetchAfter: (after: string) => Promise<CursorPage<Item>>,
  ) {
    this.data = envelope.data;
    this.has_more = envelope.has_more;
    this.next_cursor = envelope.next_cursor;
    this.response = meta.response;
    this.requestId = meta.requestId;
    this.#fetchAfter = fetchAfter;
  }

  hasNextPage(): boolean {
    return this.has_more && this.next_cursor !== null;
  }

  async nextPage(): Promise<CursorPage<Item> | null> {
    if (!this.hasNextPage()) return null;
    return this.#fetchAfter(this.next_cursor as string);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Item> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let page: CursorPage<Item> = this;
    for (;;) {
      for (const item of page.data) yield item;
      const next = await page.nextPage();
      if (next === null) return;
      page = next;
    }
  }
}

export async function fetchCursorPage<Item>(
  core: HttpCore,
  input: {
    path: string;
    query: Record<string, unknown>;
    opts?: RequestOptions | undefined;
  },
): Promise<CursorPage<Item>> {
  const { data, response, requestId } = await core.request<
    CursorPageEnvelope<Item>
  >({ method: "GET", path: input.path, query: input.query }, input.opts ?? {});
  return new CursorPage(data, { response, requestId }, (after) =>
    fetchCursorPage(core, { ...input, query: { ...input.query, after } }),
  );
}

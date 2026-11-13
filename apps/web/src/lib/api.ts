import { ApiError, createApi, type Me, unwrap } from "@signa/api-client";
import { translateError } from "@signa/core";
import { infiniteQueryOptions, QueryClient, queryOptions } from "@tanstack/react-query";

export const api = createApi();
export { ApiError, unwrap };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: async (): Promise<Me | null> => {
    try {
      return await unwrap(api.GET("/api/v1/me"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  staleTime: 5 * 60_000,
});

export const healthQuery = queryOptions({
  queryKey: ["health"],
  queryFn: () => unwrap(api.GET("/api/v1/health")),
  staleTime: Infinity,
});

export const catalogQuery = queryOptions({
  queryKey: ["catalog"],
  queryFn: () => unwrap(api.GET("/api/v1/catalog")),
});

/** Every list of the school, drafts and every group's included, for the admin pages. */
export const adminCatalogQuery = queryOptions({
  queryKey: ["catalog", "admin"],
  queryFn: () => unwrap(api.GET("/api/v1/admin/catalog")),
});

export interface WordFilter {
  year?: number;
  lesson?: number;
  list_number?: string;
  q?: string;
  with_clip?: boolean;
}

export const wordsQuery = (filter: WordFilter) =>
  queryOptions({
    queryKey: ["words", filter],
    queryFn: () => unwrap(api.GET("/api/v1/words", { params: { query: filter } })),
  });

/** How many words the dictionary loads at a time. */
export const WORDS_PAGE = 30;

/** Words in pages of {@link WORDS_PAGE}, for lists that load more as you scroll. */
export const wordPagesQuery = (filter: WordFilter) =>
  infiniteQueryOptions({
    queryKey: ["words", "pages", filter],
    queryFn: ({ pageParam }) =>
      unwrap(api.GET("/api/v1/words", { params: { query: { ...filter, limit: WORDS_PAGE, offset: pageParam } } })),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length < WORDS_PAGE ? undefined : pages.length * WORDS_PAGE),
  });

export const wordQuery = (id: number) =>
  queryOptions({
    queryKey: ["word", id],
    queryFn: () => unwrap(api.GET("/api/v1/words/{word_id}", { params: { path: { word_id: id } } })),
  });

export const difficultQuery = queryOptions({
  queryKey: ["difficult"],
  queryFn: () => unwrap(api.GET("/api/v1/me/difficult-words")),
});

export function isStaff(me: Me | null | undefined): boolean {
  return me?.role === "teacher" || me?.role === "admin";
}

/** A message to show; API errors are translated when we know them. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return translateError(e.message);
  return e instanceof Error ? e.message : String(e);
}

/**
 * The application-shell HTTP-client boundary the processor client drives, named for the suites that
 * assert on it.
 *
 * The shell's published declaration re-exports `executeHttpClientRequest` from a path outside its own
 * package, so the symbol resolves to `any`: it types neither the fetcher it is handed nor the config
 * passed beside it, and an unannotated mock implementation would silently accept any call shape at
 * all. Declaring the shapes here is what keeps the suites checking the calls they make — the same
 * reason `src/hooks/use-processor-client` declares its own options type structurally.
 */

/** The pre-configured options the shell hands the fetcher (credentials + the headers it assembled). */
type ForwardHttpClientOptions = {
  credentials: RequestCredentials;
  headers: Record<string, string>;
};

/** The fetcher the client hands `executeHttpClientRequest`. */
export type ForwardFetcher = (
  options: ForwardHttpClientOptions
) => Promise<{ data: unknown }>;

/**
 * One `executeHttpClientRequest` call: the fetcher, and the forward-to config the client sends with
 * it. Neither panel route carries headers — the processor derives the store from the resource — so the
 * config the client builds is exactly these two members.
 */
export type ForwardCall = [
  ForwardFetcher,
  { forwardToConfig: { uri: string; includeUserPermissions: boolean } }
];

/* Browser wallet extensions (client only). Two providers speak to the lending-hackathon devnet
   once the user has added it as a custom network in the extension: Crossmark injects
   `window.xrpl.crossmark`, GemWallet is reached through `@gemwallet/api`. Both give us an
   address at connect time and sign-and-submit a transaction JSON we prepared server-side. */

export type ExtensionProvider = "crossmark" | "gemwallet";

export const PROVIDER_LABEL: Record<ExtensionProvider, string> = { crossmark: "Crossmark", gemwallet: "GemWallet" };

type Json = Record<string, unknown>;

type CrossmarkResponse<T> = { response?: { data?: T } };
type CrossmarkMethods = {
  signInAndWait: () => Promise<CrossmarkResponse<{ address?: string; network?: { wss?: string; rpc?: string; label?: string } }>>;
  getNetworkAndWait?: () => Promise<CrossmarkResponse<{ network?: { wss?: string; rpc?: string; label?: string } }>>;
  signAndSubmitAndWait: (tx: Json) => Promise<CrossmarkResponse<{ resp?: { result?: { hash?: string; meta?: { TransactionResult?: string } } } }>>;
};
type CrossmarkInjected = Partial<CrossmarkMethods> & { methods?: CrossmarkMethods };

declare global {
  interface Window {
    xrpl?: { crossmark?: CrossmarkInjected };
    gemWallet?: boolean;
  }
}

const crossmark = (): CrossmarkMethods | null => {
  const injected = typeof window !== "undefined" ? window.xrpl?.crossmark : undefined;
  if (!injected) return null;
  const m = injected.methods ?? injected;
  return m.signInAndWait && m.signAndSubmitAndWait ? (m as CrossmarkMethods) : null;
};

/** Providers detected in this browser, in display order. */
export async function detectProviders(): Promise<ExtensionProvider[]> {
  if (typeof window === "undefined") return [];
  const found: ExtensionProvider[] = [];
  if (crossmark()) found.push("crossmark");
  try {
    const gem = await import("@gemwallet/api");
    if ((await gem.isInstalled()).result.isInstalled) found.push("gemwallet");
  } catch {
    /* package missing or extension absent */
  }
  return found;
}

export type ExtensionSession = {
  address: string;
  /** WebSocket endpoint the extension is currently on, when it tells us (GemWallet always, Crossmark when present). */
  network: string | null;
};

const host = (url: string | null | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
};

/** True when the extension's reported endpoint is `expected` (host:port compare); null when unknown. */
export const onExpectedNetwork = (session: ExtensionSession, expected: string): boolean | null =>
  session.network === null ? null : host(session.network) === host(expected);

/** Asks the extension for the active account (and its network when exposed). Throws on refusal. */
export async function connectExtension(provider: ExtensionProvider): Promise<ExtensionSession> {
  if (provider === "crossmark") {
    const cm = crossmark();
    if (!cm) throw new Error("Crossmark is not installed.");
    const data = (await cm.signInAndWait()).response?.data;
    if (!data?.address) throw new Error("Crossmark did not return an address.");
    let network = data.network?.wss ?? null;
    if (!network && cm.getNetworkAndWait) {
      try {
        network = (await cm.getNetworkAndWait()).response?.data?.network?.wss ?? null;
      } catch {
        /* older Crossmark: network unknown */
      }
    }
    return { address: data.address, network };
  }
  const gem = await import("@gemwallet/api");
  const res = await gem.getAddress();
  if (res.type !== "response" || !res.result?.address) throw new Error("GemWallet did not return an address.");
  let network: string | null = null;
  try {
    const net = await gem.getNetwork();
    if (net.type === "response") network = net.result?.websocket ?? null;
  } catch {
    /* network unknown */
  }
  return { address: res.result.address, network };
}

/** Signs and submits one prepared transaction; resolves with the hash once the extension reports it. */
export async function signAndSubmit(provider: ExtensionProvider, tx: Json): Promise<string> {
  if (provider === "crossmark") {
    const cm = crossmark();
    if (!cm) throw new Error("Crossmark is not installed.");
    const result = (await cm.signAndSubmitAndWait(tx)).response?.data?.resp?.result;
    if (!result?.hash) throw new Error("Crossmark did not return a transaction hash (rejected?).");
    const code = result.meta?.TransactionResult;
    if (code && code !== "tesSUCCESS") throw new Error(`Ledger rejected the transaction: ${code}`);
    return result.hash;
  }
  const gem = await import("@gemwallet/api");
  const res = await gem.submitTransaction({ transaction: tx as never });
  if (res.type !== "response" || !res.result?.hash) throw new Error("GemWallet did not return a transaction hash (rejected?).");
  return res.result.hash;
}

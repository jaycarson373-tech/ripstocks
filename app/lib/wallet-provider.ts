export type EthereumProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  providers?: EthereumProvider[];
  isPhantom?: boolean;
  isRobinhood?: boolean;
};

type ProviderInfo = {
  name?: string;
  rdns?: string;
};

type ProviderCandidate = {
  provider: EthereumProvider;
  info?: ProviderInfo;
};

type ProviderHost = {
  ethereum?: EthereumProvider;
  addEventListener: (type: string, listener: EventListener) => void;
  dispatchEvent: (event: Event) => boolean;
};

const announcedProviders: ProviderCandidate[] = [];
let providerDiscoveryStarted = false;

export const ROBINHOOD_CHAIN_ID = 4663;
const ROBINHOOD_CHAIN_HEX = "0x1237";

function providerIdentity(candidate: ProviderCandidate) {
  return `${candidate.info?.name ?? ""} ${candidate.info?.rdns ?? ""}`.toLowerCase();
}

export function isPhantomProvider(candidate: ProviderCandidate): boolean {
  return candidate.provider.isPhantom === true || providerIdentity(candidate).includes("phantom");
}

export function selectEvmProvider(candidates: ProviderCandidate[]): EthereumProvider | null {
  const compatible = candidates.filter((candidate) => candidate.provider && !isPhantomProvider(candidate));
  return compatible.find((candidate) => candidate.provider.isRobinhood === true || providerIdentity(candidate).includes("robinhood"))?.provider
    ?? compatible[0]?.provider
    ?? null;
}

function startProviderDiscovery(host: ProviderHost) {
  if (providerDiscoveryStarted) return;
  providerDiscoveryStarted = true;
  host.addEventListener("eip6963:announceProvider", ((event: CustomEvent<ProviderCandidate>) => {
    const candidate = event.detail;
    if (!candidate?.provider || announcedProviders.some((entry) => entry.provider === candidate.provider)) return;
    announcedProviders.push(candidate);
  }) as EventListener);
  host.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function findEvmProvider(host: ProviderHost): EthereumProvider | null {
  startProviderDiscovery(host);
  const legacy = host.ethereum;
  const legacyProviders = legacy?.providers?.map((provider) => ({ provider })) ?? (legacy ? [{ provider: legacy }] : []);
  return selectEvmProvider([...announcedProviders, ...legacyProviders]);
}

export function walletAccount(value: unknown): string {
  const account = Array.isArray(value) ? value[0] : undefined;
  return typeof account === "string" && /^0x[0-9a-fA-F]{40}$/.test(account) ? account : "";
}

export function walletChainId(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  const chainId = Number.parseInt(value, 16);
  return Number.isSafeInteger(chainId) ? chainId : null;
}

export async function ensureRobinhoodChain(provider: EthereumProvider): Promise<number> {
  if (walletChainId(await provider.request({ method: "eth_chainId" })) === ROBINHOOD_CHAIN_ID) {
    return ROBINHOOD_CHAIN_ID;
  }
  const switchChain = () => provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ROBINHOOD_CHAIN_HEX }] });
  try {
    await switchChain();
  } catch (error) {
    if ((error as { code?: number })?.code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: ROBINHOOD_CHAIN_HEX,
        chainName: "Robinhood Chain",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
        blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
      }],
    });
    // Adding a network does not guarantee the wallet switched to it.
    if (walletChainId(await provider.request({ method: "eth_chainId" })) !== ROBINHOOD_CHAIN_ID) await switchChain();
  }
  const actualChain = walletChainId(await provider.request({ method: "eth_chainId" }));
  if (actualChain !== ROBINHOOD_CHAIN_ID) throw new Error("WALLET_WRONG_NETWORK");
  return actualChain;
}

export function walletErrorMessage(error: unknown): string {
  const code = (error as { code?: number })?.code;
  if (code === 4001) return "Wallet request cancelled. You can try again when ready.";
  if (code === -32002) return "A wallet request is already open. Check your wallet to continue.";
  if (error instanceof Error && error.message === "WALLET_WRONG_NETWORK") return "Switch your wallet to Robinhood Chain to continue.";
  return "Could not connect to Robinhood Chain. Open your wallet and try again.";
}

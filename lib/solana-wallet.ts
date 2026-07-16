export type SolanaPublicKey = { toString: () => string };
export type SolanaProvider = {
  isPhantom?: boolean;
  isBackpack?: boolean;
  publicKey?: SolanaPublicKey | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: SolanaPublicKey }>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (transaction: unknown) => Promise<{ signature: string }>;
  on?: (event: "connect" | "disconnect" | "accountChanged", handler: (key?: SolanaPublicKey | null) => void) => void;
  off?: (event: "connect" | "disconnect" | "accountChanged", handler: (key?: SolanaPublicKey | null) => void) => void;
};
type WalletWindow = Window & { solana?: SolanaProvider & { providers?: SolanaProvider[] }; phantom?: { solana?: SolanaProvider }; backpack?: { solana?: SolanaProvider } };

export function detectSolanaProvider(): SolanaProvider | null {
  if (typeof window === "undefined") return null;
  const walletWindow = window as WalletWindow;
  const injected = walletWindow.solana?.providers?.find(provider => provider.isPhantom || provider.isBackpack);
  return walletWindow.phantom?.solana ?? walletWindow.backpack?.solana ?? injected ?? walletWindow.solana ?? null;
}

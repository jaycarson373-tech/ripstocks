import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ROBINHOOD_CHAIN_ID, addressEnv, required } from "./pons-core.mjs";
import { packConfig } from "./pack-config.mjs";

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const packAbi = parseAbi([
  "function packPrice() view returns (uint256)",
  "function owner() view returns (address)",
  "function treasury() view returns (address)",
  "function packsEnabled() view returns (bool)",
  "function activeRequestId() view returns (uint256)",
  "function inventoryCount() view returns (uint256)",
  "function setPacksEnabled(bool enabled)",
]);

function signerKey(value) {
  const raw = required("AUTOMATION_PRIVATE_KEY", value);
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error("AUTOMATION_PRIVATE_KEY must be a 32-byte hex key");
  return normalized;
}

function output(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ event, ...fields })}\n`);
}

async function main() {
  if (process.env.ENABLE_PACKS_CONFIRM !== "I_UNDERSTAND") {
    throw new Error("Set ENABLE_PACKS_CONFIRM=I_UNDERSTAND only after funded inventory has been verified");
  }
  const contract = addressEnv("STOCKRIPS_PACK_CONTRACT", process.env.STOCKRIPS_PACK_CONTRACT);
  const account = privateKeyToAccount(signerKey(process.env.AUTOMATION_PRIVATE_KEY));
  const rpcUrl = process.env.ROBINHOOD_RPC_URL?.trim() || robinhood.rpcUrls.default.http[0];
  const transport = http(rpcUrl, { retryCount: 3, retryDelay: 1_000, timeout: 30_000 });
  const publicClient = createPublicClient({ chain: robinhood, transport });
  const walletClient = createWalletClient({ account, chain: robinhood, transport });
  if (await publicClient.getChainId() !== ROBINHOOD_CHAIN_ID) throw new Error("RPC is not Robinhood Chain mainnet");
  if (await publicClient.readContract({ address: contract, abi: packAbi, functionName: "packPrice" }) !== packConfig(process.env.PACK_ID).priceAtoms) throw new Error("Pack price differs from the configured catalog");

  const [owner, treasury, enabled, activeRequestId, inventoryCount] = await Promise.all([
    publicClient.readContract({ address: contract, abi: packAbi, functionName: "owner" }),
    publicClient.readContract({ address: contract, abi: packAbi, functionName: "treasury" }),
    publicClient.readContract({ address: contract, abi: packAbi, functionName: "packsEnabled" }),
    publicClient.readContract({ address: contract, abi: packAbi, functionName: "activeRequestId" }),
    publicClient.readContract({ address: contract, abi: packAbi, functionName: "inventoryCount" }),
  ]);
  if (getAddress(owner) !== account.address || getAddress(treasury) !== account.address) {
    throw new Error("Automation wallet must be both pack owner and treasury");
  }
  if (activeRequestId !== 0n) throw new Error("Cannot change pack state while a request is active");
  if (inventoryCount === 0n) throw new Error("Cannot enable packs with empty inventory");
  if (enabled) {
    output("packs_already_enabled", { packContract: contract, fundedPacks: inventoryCount.toString() });
    return;
  }

  const hash = await walletClient.writeContract({
    account,
    address: contract,
    abi: packAbi,
    functionName: "setPacksEnabled",
    args: [true],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`Pack activation reverted: ${hash}`);
  output("packs_enabled", { packContract: contract, fundedPacks: inventoryCount.toString(), transactionHash: hash });
}

main().catch((error) => {
  output("pack_activation_failed", { reason: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});

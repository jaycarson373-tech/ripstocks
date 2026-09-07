import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CANONICAL_USDG,
  ROBINHOOD_CHAIN_ID,
  addressEnv,
  discoverContractStartBlock,
  required,
} from "./pons-core.mjs";
import { packConfig } from "./pack-config.mjs";
const pack = packConfig(process.env.PACK_ID);

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
  "function inventoryCount() view returns (uint256)",
  "function approvedStock(address token) view returns (bool)",
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

async function validatePack(publicClient, address, account) {
  if (await publicClient.readContract({ address, abi: packAbi, functionName: "packPrice" }) !== pack.priceAtoms) throw new Error("Deployed price does not match configured pack");
  const [owner, treasury, packsEnabled, inventoryCount, approvals] = await Promise.all([
    publicClient.readContract({ address, abi: packAbi, functionName: "owner" }),
    publicClient.readContract({ address, abi: packAbi, functionName: "treasury" }),
    publicClient.readContract({ address, abi: packAbi, functionName: "packsEnabled" }),
    publicClient.readContract({ address, abi: packAbi, functionName: "inventoryCount" }),
    Promise.all(pack.stocks.map((stock) => publicClient.readContract({
      address,
      abi: packAbi,
      functionName: "approvedStock",
      args: [stock.address],
    }))),
  ]);
  if (getAddress(owner) !== account.address) throw new Error("Automation wallet is not the pack-contract owner");
  if (getAddress(treasury) !== account.address) throw new Error("Pack treasury is not the automation wallet");
  if (approvals.some((approved) => !approved)) throw new Error("Pack contract does not approve the complete ten-token prize pool");
  return { packsEnabled, inventoryCount };
}

async function main() {
  const rpcUrl = process.env.ROBINHOOD_RPC_URL?.trim() || robinhood.rpcUrls.default.http[0];
  const account = privateKeyToAccount(signerKey(process.env.AUTOMATION_PRIVATE_KEY));
  const transport = http(rpcUrl, { retryCount: 3, retryDelay: 1_000, timeout: 30_000 });
  const publicClient = createPublicClient({ chain: robinhood, transport });
  const walletClient = createWalletClient({ account, chain: robinhood, transport });

  const chainId = await publicClient.getChainId();
  if (chainId !== ROBINHOOD_CHAIN_ID) throw new Error(`RPC returned chain ${chainId}; expected Robinhood Chain ${ROBINHOOD_CHAIN_ID}`);

  let packContract = process.env.STOCKRIPS_PACK_CONTRACT?.trim()
    ? addressEnv("STOCKRIPS_PACK_CONTRACT", process.env.STOCKRIPS_PACK_CONTRACT)
    : null;
  let deployed = false;
  let deploymentTransaction = null;
  if (!packContract) {
    if (process.env.DEPLOY_PACK_CONFIRM !== "DEPLOY_NEW_PACK") throw new Error("Set DEPLOY_PACK_CONFIRM=DEPLOY_NEW_PACK only for a new deployment; use STOCKRIPS_PACK_CONTRACT to resume an existing one");
    const artifactUrl = new URL("./artifacts/StonkRips.json", import.meta.url);
    const artifact = JSON.parse(await readFile(artifactUrl, "utf8"));
    const bytecode = artifact.bytecode?.object;
    if (!bytecode || bytecode === "0x") throw new Error("Missing compiled StonkRips bytecode; run forge build first");
    deploymentTransaction = await walletClient.deployContract({
      account,
      abi: artifact.abi,
      bytecode: bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`,
      args: [account.address, pack.stocks.map((stock) => stock.address), pack.priceAtoms],
    });
    output("pack_deployment_broadcast", { deploymentTransaction, instruction: "Save this hash. If interrupted, recover its contract address from the receipt; do not deploy again." });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction, confirmations: 2, timeout: 180_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Pack-contract deployment failed");
    packContract = getAddress(receipt.contractAddress);
    deployed = true;
  }

  const state = await validatePack(publicClient, packContract, account);
  output("launch_bootstrap_complete", {
    chainId,
    automationWallet: account.address,
    packId: pack.id,
    packPriceUsdgAtoms: pack.priceUsdgAtoms,
    settlementToken: CANONICAL_USDG,
    packContractStartBlock: (await discoverContractStartBlock(await publicClient.getBlockNumber(), blockNumber => publicClient.getBytecode({ address: packContract, blockNumber }))).toString(),
    packContract,
    packContractDeployed: deployed,
    deploymentTransaction,
    packsEnabled: state.packsEnabled,
    fundedPacks: state.inventoryCount.toString(),
    zeroXConfigured: Boolean(process.env.ZEROX_API_KEY?.trim()),
    supabaseConfigured: Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()),
    safeModePreserved: true,
  });
}

main().catch((error) => {
  output("launch_bootstrap_failed", { reason: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
});

import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  parseAbi,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  CANONICAL_SPY,
  PONS_V2_FACTORY,
  PONS_V2_FEE_LOCKER,
  ROBINHOOD_CHAIN_ID,
  STOCK_TOKENS,
  addressEnv,
  discoverContractStartBlock,
  required,
} from "./pons-core.mjs";

const robinhood = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
});

const factoryAbi = parseAbi([
  "function getLaunchedToken(address token) view returns ((address token,address deployer,address pairedToken,address positionManager,uint256 positionId,uint256 dexId,uint256 launchConfigId,uint256 restrictionsEndBlock,uint256 supply,bool isToken0,uint24 poolFee,bool exists,uint256 initialBuyAmount))",
]);
const feeLockerAbi = parseAbi(["function feeRedirects(address token) view returns (address)"]);
const packAbi = parseAbi([
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
  const [owner, treasury, packsEnabled, inventoryCount, approvals] = await Promise.all([
    publicClient.readContract({ address, abi: packAbi, functionName: "owner" }),
    publicClient.readContract({ address, abi: packAbi, functionName: "treasury" }),
    publicClient.readContract({ address, abi: packAbi, functionName: "packsEnabled" }),
    publicClient.readContract({ address, abi: packAbi, functionName: "inventoryCount" }),
    Promise.all(STOCK_TOKENS.map((stock) => publicClient.readContract({
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
  const ponsToken = addressEnv("PONS_TOKEN_ADDRESS", process.env.PONS_TOKEN_ADDRESS);
  const factory = addressEnv("PONS_V2_FACTORY", process.env.PONS_V2_FACTORY || PONS_V2_FACTORY);
  const feeLocker = addressEnv("PONS_FEE_LOCKER", process.env.PONS_FEE_LOCKER || PONS_V2_FEE_LOCKER);
  const account = privateKeyToAccount(signerKey(process.env.AUTOMATION_PRIVATE_KEY));
  const transport = http(rpcUrl, { retryCount: 3, retryDelay: 1_000, timeout: 30_000 });
  const publicClient = createPublicClient({ chain: robinhood, transport });
  const walletClient = createWalletClient({ account, chain: robinhood, transport });

  const chainId = await publicClient.getChainId();
  if (chainId !== ROBINHOOD_CHAIN_ID) throw new Error(`RPC returned chain ${chainId}; expected Robinhood Chain ${ROBINHOOD_CHAIN_ID}`);

  const launch = await publicClient.readContract({ address: factory, abi: factoryAbi, functionName: "getLaunchedToken", args: [ponsToken] });
  if (!launch.exists || getAddress(launch.token) !== ponsToken) throw new Error("PONS_TOKEN_ADDRESS is not registered by the current Pons v2 factory");
  if (getAddress(launch.pairedToken) !== getAddress(CANONICAL_SPY)) throw new Error("Pons token is not paired with canonical SPY");
  const redirect = await publicClient.readContract({ address: feeLocker, abi: feeLockerAbi, functionName: "feeRedirects", args: [ponsToken] });
  const feeRecipient = getAddress(redirect) === zeroAddress ? getAddress(launch.deployer) : getAddress(redirect);
  if (feeRecipient !== account.address) throw new Error("Automation wallet is not the current Pons creator-fee recipient");

  const latestBlock = await publicClient.getBlockNumber();
  const ponsTokenStartBlock = await discoverContractStartBlock(
    latestBlock,
    (blockNumber) => publicClient.getBytecode({ address: ponsToken, blockNumber }),
  );

  let packContract = process.env.STOCKRIPS_PACK_CONTRACT?.trim()
    ? addressEnv("STOCKRIPS_PACK_CONTRACT", process.env.STOCKRIPS_PACK_CONTRACT)
    : null;
  let deployed = false;
  let deploymentTransaction = null;
  if (!packContract) {
    const artifactUrl = new URL("../contracts/out/StonkRips.sol/StonkRips.json", import.meta.url);
    const artifact = JSON.parse(await readFile(artifactUrl, "utf8"));
    const bytecode = artifact.bytecode?.object;
    if (!bytecode || bytecode === "0x") throw new Error("Missing compiled StonkRips bytecode; run forge build first");
    deploymentTransaction = await walletClient.deployContract({
      account,
      abi: artifact.abi,
      bytecode: bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`,
      args: [account.address, STOCK_TOKENS.map((stock) => stock.address)],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: deploymentTransaction, confirmations: 2, timeout: 180_000 });
    if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("Pack-contract deployment failed");
    packContract = getAddress(receipt.contractAddress);
    deployed = true;
  }

  const state = await validatePack(publicClient, packContract, account);
  output("launch_bootstrap_complete", {
    chainId,
    automationWallet: account.address,
    ponsToken,
    ponsTokenStartBlock: ponsTokenStartBlock.toString(),
    ponsFactory: factory,
    ponsFeeLocker: feeLocker,
    quoteToken: getAddress(CANONICAL_SPY),
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

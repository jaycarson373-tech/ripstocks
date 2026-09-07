// Build-time only. Railway receives the minimal compiled artifact, not a compiler.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const source = await readFile(new URL("../contracts/StonkRips.sol", import.meta.url), "utf8");
let artifact;
if (process.env.SOLC_MODULE) {
  const { default: solc } = await import(process.env.SOLC_MODULE);
  if (!solc.version().startsWith("0.8.24+")) throw new Error("Use the pinned Solidity 0.8.24 compiler");
  const compiled = JSON.parse(solc.compile(JSON.stringify({ language: "Solidity", sources: { "contracts/StonkRips.sol": { content: source } }, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } })));
  if (compiled.errors?.some(error => error.severity === "error")) throw new Error("Contract compilation failed");
  const contract = compiled.contracts["contracts/StonkRips.sol"].StonkRips;
  artifact = { abi: contract.abi, bytecode: { object: `0x${contract.evm.bytecode.object}` } };
} else {
  const built = JSON.parse(await readFile(new URL("../contracts/out/StonkRips.sol/StonkRips.json", import.meta.url), "utf8"));
  artifact = { abi: built.abi, bytecode: built.bytecode };
}
artifact.sourceSha256 = createHash("sha256").update(source).digest("hex");
await mkdir(new URL("../worker/artifacts/", import.meta.url), { recursive: true });
await writeFile(new URL("../worker/artifacts/StonkRips.json", import.meta.url), JSON.stringify(artifact, null, 2) + "\n");
console.log("Prepared the disabled pack-contract deployment artifact. No transaction sent.");

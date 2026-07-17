export const SOL_GAS_BUFFER = 0.111;
export const MAIN_INVENTORY_LOTS = [3,3,3,3,3,3,5,7,8,10,12,15,20,25,30] as const;
export const HOLDER_INVENTORY_LOTS = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30] as const;

export function total(values: readonly number[]) { return values.reduce((sum,value)=>sum+value,0); }
export function average(values: readonly number[]) { return values.length ? total(values)/values.length : 0; }

export type XStockTarget = { symbol:string; mint:string; enabled:boolean; weight?:number };

export function parseTargets(raw=process.env.XSTOCK_TARGETS_JSON || "[]") {
  const normalized=raw.trim()
    .replace(/^XSTOCK_TARGETS_JSON\s*=\s*/, "")
    .replace(/^(["'])([\s\S]*)\1$/, "$2");
  const targets=(JSON.parse(normalized) as XStockTarget[]).filter(target=>target.enabled);
  if(targets.length!==10) throw new Error("Exactly 10 enabled meme targets are required");
  return targets;
}

export function buildInventoryPlan(targets:XStockTarget[]) {
  const assign=(values:readonly number[],offset:number)=>values.map((usd,index)=>({usd,symbol:targets[(index+offset)%targets.length].symbol,mint:targets[(index+offset)%targets.length].mint}));
  return {
    solGasBuffer:SOL_GAS_BUFFER,
    main:{totalUsd:total(MAIN_INVENTORY_LOTS),averageUsd:average(MAIN_INVENTORY_LOTS),packs:MAIN_INVENTORY_LOTS.length,purchases:assign(MAIN_INVENTORY_LOTS,0)},
    holder:{totalUsd:total(HOLDER_INVENTORY_LOTS),averageUsd:average(HOLDER_INVENTORY_LOTS),packs:HOLDER_INVENTORY_LOTS.length,purchases:assign(HOLDER_INVENTORY_LOTS,5)},
  };
}

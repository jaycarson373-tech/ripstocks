import { ACTIVE_PACK, PACK_PRICE_USD } from "@/app/lib/pack-config";
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StonkRips",
    short_name: "StonkRips",
    description: `${ACTIVE_PACK.label} — ${PACK_PRICE_USD}. Rip funded onchain Stock Token packs.`,
    start_url: "/",
    display: "standalone",
    background_color: "#030403",
    theme_color: "#c7ff00",
    icons: [
      { src: "/stonkrips-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/stonkrips-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}

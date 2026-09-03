import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StonkRips",
    short_name: "StonkRips",
    description: "Rip $20 packs and pull funded onchain Stock Tokens.",
    start_url: "/",
    display: "standalone",
    background_color: "#030403",
    theme_color: "#c7ff00",
    icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}

import type { MetadataRoute } from "next";

// PWA manifest (docs/ledger-step3-B.md, Section 6). Installing matters on
// iPhone: iOS only allows web push for apps added to the Home Screen.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ledger",
    short_name: "Ledger",
    description: "Snap a photo of any government letter. Ledger reads it, explains it in your language, and does the follow-up work.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1c1c1c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

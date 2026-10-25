import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()],
    // shared/ and convex/_generated live one level up.
    server: { fs: { allow: [".."] } },
  }),
  manifest: {
    name: "LarpAI",
    description: "Is this listing larping? Checks whether a shopping listing matches what you'll actually get.",
    // storage: remembers the one-time data notice. scripting: re-inject the content script into tabs opened before the extension (re)loaded.
    permissions: ["sidePanel", "tabs", "scripting", "storage"],
    host_permissions: [
      "*://item.taobao.com/*",
      "*://detail.tmall.com/*",
      "*://world.taobao.com/*",
      "*://*.temu.com/*",
      "*://*.amazon.com/*",
      "*://*.amazon.co.uk/*",
      "*://*.amazon.ca/*",
    ],
    action: { default_title: "Check this listing" },
  },
});

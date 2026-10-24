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
    permissions: ["sidePanel", "tabs"],
    host_permissions: ["*://item.taobao.com/*", "*://detail.tmall.com/*"],
    action: { default_title: "Check this listing" },
  },
});

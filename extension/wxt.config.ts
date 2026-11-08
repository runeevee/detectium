import path from "node:path";
import { defineConfig } from "wxt";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],
  manifest: {
    name: "Detectium",
    description: "",
    permissions: ["storage", "contextMenus", "activeTab"],
    host_permissions: [
      "https://api.openai.com/*",
      "*://*.cdninstagram.com/*",
      "*://*.fbcdn.net/*",
      "*://*.twimg.com/*",
      "*://pbs.twimg.com/*",
      "*://*.instagram.com/*",
      "*://*.x.com/*",
      "*://*.twitter.com/*",
      "<all_urls>",
    ],
    webExt: {
      chromiumArgs: [
        '--enable-blink-features=AutomationControlled',
        '--test-type',
    ],
  },
  vite: () => ({
    define: {
      "process.env.OPENAI_API_KEY": JSON.stringify(process.env.OPENAI_API_KEY || ""),
    },
    resolve: {
      alias: {
        "@css": path.resolve(import.meta.dirname, "./res/css"),
        "@font": path.resolve(import.meta.dirname, "./res/font"),
      },
    },
  }),
});

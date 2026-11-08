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
    host_permissions: ["https://api.openai.com/*"],
    chromiumArgs: ["--disable-features=DisableLoadExtensionCommandLineSwitch"],
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

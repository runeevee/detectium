
import path from "node:path";
import { defineConfig } from "wxt";
import dotenv from "dotenv";

// .env 파일의 위치를 명확하게 지정
// wxt.config.ts와 같은 폴더에 .env가 있다고 가정
const envPath = path.resolve(import.meta.dirname, ".env");

// 환경변수 불러오기
dotenv.config({
  path: envPath,
  override: true,
});

const apiKey = process.env.OPENAI_API_KEY?.trim() || "";

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],

  manifest: {
    name: "Detectium",
    description: "",
    icons: {
      16: "img/logo-16.png",
      32: "img/logo-32.png",
      48: "img/logo-48.png",
      128: "img/logo-128.png",
    },
    action: {
      default_icon: {
        16: "img/logo-16.png",
        32: "img/logo-32.png",
      },
    },
    permissions: ["storage", "contextMenus", "activeTab", "downloads"],
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
  },

  vite: () => ({
    define: {
      "process.env.OPENAI_API_KEY": JSON.stringify(apiKey),
    },

    resolve: {
      alias: {
        "@css": path.resolve(import.meta.dirname, "./res/css"),
        "@font": path.resolve(import.meta.dirname, "./res/font"),
      },
    },
  }),
});

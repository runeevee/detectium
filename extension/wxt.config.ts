
import path from "node:path";
import { defineConfig } from "wxt";
import dotenv from "dotenv";

// .env 파일의 위치를 명확하게 지정
// wxt.config.ts와 같은 폴더에 .env가 있다고 가정
const envPath = path.resolve(import.meta.dirname, ".env");

// 환경변수 불러오기
const envResult = dotenv.config({
  path: envPath,
});

// API 키 가져오기
const apiKey = process.env.OPENAI_API_KEY?.trim() || "";

// API 키 값 자체는 출력하지 않고 설정 여부만 확인
console.log("[Detectium] .env 경로:", envPath);
console.log("[Detectium] .env 로드 상태:", !envResult.error);
console.log("[Detectium] API 키 설정 여부:", Boolean(apiKey));

export default defineConfig({
  modules: ["@wxt-dev/module-solid"],

  manifest: {
    name: "Detectium",
    description: "",

    permissions: [
      "storage",
      "contextMenus",
      "activeTab",
      "downloads",
    ],

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
      // 기존 코드에서 process.env.OPENAI_API_KEY를
      // 사용하는 부분에 환경변수 값을 전달
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

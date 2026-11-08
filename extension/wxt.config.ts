import { defineConfig } from 'wxt';
import dotenv from 'dotenv';

dotenv.config();

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  webExt: {
    chromiumArgs: ['--disable-features=DisableLoadExtensionCommandLineSwitch'],
  },
  manifest: {
    name: 'Detectium',
    description: 'Detectium - SNS 통계 왜곡 및 가짜뉴스 자동 팩트체크 확장 프로그램',
    permissions: ['storage', 'contextMenus', 'activeTab'],
    host_permissions: ['https://api.openai.com/*'],
  },
  vite: () => ({
    define: {
      'process.env.OPENAI_API_KEY': JSON.stringify(process.env.OPENAI_API_KEY || ''),
    },
  }),
});

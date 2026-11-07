import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  manifest: {
    name: 'Detectium',
    description: 'Detectium Chrome Extension',
    permissions: ['storage', 'contextMenus', 'activeTab'],
  },
});

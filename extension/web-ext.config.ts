import { resolve } from "node:path";
import { defineWebExtConfig } from "wxt";

export default defineWebExtConfig({
  // On Windows, the path must be absolute
  chromiumProfile: resolve(".wxt/chrome-data"),
  keepProfileChanges: true,
});

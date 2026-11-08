import { render } from "solid-js/web";
import "@css/variable.css";
import "@css/global.css";
import App from "./app";

const root = document.getElementById("root");
if (root) {
  render(() => <App />, root);
}

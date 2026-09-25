import { runCheck } from "./monitor.js";
import { summaryText } from "./messages.js";

const res = await runCheck(false);
if (res.status === "empty") {
  console.log("No routes to check.");
} else {
  console.log(summaryText(res.results, res.errors).replace(/<[^>]+>/g, ""));
}

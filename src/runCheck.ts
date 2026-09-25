import { runCheck, formatSummary } from "./monitor.js";

const res = await runCheck(false);
if (res.status === "empty") {
  console.log("No routes to check.");
} else {
  console.log(formatSummary(res.results, res.errors));
}

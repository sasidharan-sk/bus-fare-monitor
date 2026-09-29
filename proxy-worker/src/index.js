const OWNER = "sasidharan-sk";
const REPO = "bus-fare-monitor";
const WORKFLOW = "check.yml";

const ghHeaders = (token) => ({
  authorization: `Bearer ${token}`,
  accept: "application/vnd.github+json",
  "user-agent": "bus-fare-proxy-cron",
  "x-github-api-version": "2022-11-28",
});

async function anyActiveRun(token) {
  for (const status of ["in_progress", "queued"]) {
    const res = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?status=${status}&per_page=1`,
      { headers: ghHeaders(token) },
    );
    if (!res.ok) throw new Error(`list runs ${status}: HTTP ${res.status}`);
    const data = await res.json();
    if ((data.total_count ?? 0) > 0) return true;
  }
  return false;
}

async function dispatchCheck(env) {
  const token = env.GITHUB_TOKEN;
  if (!token) return "error: GITHUB_TOKEN not set";
  if (await anyActiveRun(token)) return "skipped: a run is already active";
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: { ...ghHeaders(token), "content-type": "application/json" },
      body: JSON.stringify({ ref: "main" }),
    },
  );
  if (res.status === 204) return "dispatched";
  const body = await res.text();
  return `error: HTTP ${res.status} ${body.slice(0, 300)}`;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get("url") || url.pathname.slice(1);
    if (!target) {
      return new Response("missing ?url= parameter", { status: 400 });
    }
    let parsed;
    try {
      parsed = new URL(decodeURIComponent(target));
    } catch {
      return new Response("invalid target url", { status: 400 });
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return new Response("only http(s) targets allowed", { status: 400 });
    }
    try {
      const res = await fetch(parsed, {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
      });
      const headers = new Headers(res.headers);
      headers.set("access-control-allow-origin", "*");
      return new Response(res.body, { status: res.status, headers });
    } catch (exc) {
      return new Response(`upstream error: ${exc.message}`, { status: 502 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          const result = await dispatchCheck(env);
          console.log(`cron "${event.cron}" -> ${result}`);
        } catch (exc) {
          console.error(`cron "${event.cron}" failed: ${exc.message}`);
        }
      })(),
    );
  },
};

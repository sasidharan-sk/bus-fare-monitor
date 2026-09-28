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
};

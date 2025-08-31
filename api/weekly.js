// api/weekly.js  — Node serverless function on Vercel
export default async function handler(req, res) {
  // method & auth guard
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const bearer = req.headers.authorization?.split(" ")[1] || "";
  const REQUIRED = process.env.DEEP_TOKEN; // optional
  if (REQUIRED && bearer !== REQUIRED) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ---- Prompt (edit freely) ----
  const PROMPT = `
You are producing a weekly research digest for the EU residential solar PV & energy storage market.
TIME WINDOW: last 7 calendar days only.
SCOPE: residential PV + hybrid inverters + residential batteries (exclude C&I and utility).
GEOGRAPHY: Germany, Austria, Switzerland, Belgium, Netherlands, Italy, United Kingdom, Romania, Czech Republic, Spain, France.
SOURCES PRIORITY: national solar associations, grid operators/DSOs/TSOs, energy regulators, government portals, major distributors and installers, reputable trade media (pv-magazine, SolarPower Europe, etc.). Avoid low-quality blogs and generic SEO farms.
COMPETITORS: Huawei, SMA, Fronius, GoodWe, Growatt, Deye, SigEnergy, Dyness. Exclude Sungrow.
INCLUDE: product launches, certifications/compliance (e.g., G99, CEI 0-21, C15-712-3, NC RfG), firmware/feature updates, partnerships, pricing/positioning, policy/regulatory changes, incentives/subsidies relevant to residential PV/ESS, notable installer/distributor programs.
DE-DUPLICATE: canonicalize URLs (strip tracking params; prefer original source over rewrites).
OUTPUT: STRICT JSON only, no prose. Exactly:
{
  "articles": [
    {"url":"https://...", "title":"..."},
    ...
  ]
}
Return 10–40 high-quality items max. If nothing qualifies, return {"articles":[]}.
`.trim();

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        // Deep Research models (pick one you have access to)
        model: "o4-mini-deep-research-2025-06-26", // or "o3-deep-research-2025-06-26"
        input: [
          {
            role: "developer",
            content: [{ type: "input_text", text: PROMPT }]
          }
        ],
        tools: [{ type: "web_search_preview" }], // allow web search
        text_format: "json_object"              // ask for a JSON object as output
      })
    });

    if (!r.ok) {
      const body = await r.text();
      return res.status(502).json({ error: "OpenAI call failed", detail: body });
    }

    const data = await r.json();
    // Extract the JSON payload emitted under text_format=json_object
    const text = data?.output?.at(-1)?.content?.[0]?.text ?? "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { articles: [] };
    }

    // ensure shape
    const articles = Array.isArray(parsed.articles) ? parsed.articles : [];
    // trim and cap
    const clean = articles
      .filter(a => a && typeof a.url === "string" && a.url.startsWith("http"))
      .map(a => ({ url: a.url, title: typeof a.title === "string" ? a.title : "" }))
      .slice(0, 50);

    return res.status(200).json({ articles: clean });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
}

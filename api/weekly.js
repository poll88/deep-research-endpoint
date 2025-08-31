// api/weekly.js — Vercel serverless function that returns { articles: [{url,title}, ...] }
export default async function handler(req, res) {
  // ---- Method + auth (Bearer header or ?token=) ----
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const bearer =
    req.headers.authorization?.split(" ")[1] ||
    req.query.token ||
    "";
  const REQUIRED = process.env.DEEP_TOKEN; // set in Vercel env
  if (REQUIRED && bearer !== REQUIRED) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // ---- Research prompt (edit freely) ----
  const PROMPT = `
You are producing a weekly research digest for the EU residential solar PV & energy storage market.
TIME WINDOW: last 7 calendar days only.
SCOPE: residential PV + hybrid inverters + residential batteries (exclude C&I and utility).
GEOGRAPHY: Germany, Austria, Switzerland, Belgium, Netherlands, Italy, United Kingdom, Romania, Czech Republic, Spain, France.
SOURCES PRIORITY: national solar associations, grid operators/DSOs/TSOs, energy regulators, government portals, major distributors and installers, reputable trade media (pv-magazine, SolarPower Europe, etc.). Avoid low-quality blogs and generic SEO farms.
COMPETITORS: Huawei, SMA, Fronius, GoodWe, Growatt, Deye, SigEnergy, Dyness. Exclude Sungrow.
INCLUDE: product launches; certifications/compliance (e.g., G99, CEI 0-21, C15-712-3, NC RfG); firmware/feature updates; partnerships; pricing/positioning; policy/regulatory changes; incentives/subsidies relevant to residential PV/ESS; notable installer/distributor programs.
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
    const result = await callOpenAI(PROMPT);
    if (!result.ok) {
      return res.status(502).json({ error: "OpenAI call failed", detail: result.detail });
    }

    // Parse JSON object the model returned (we requested response_format=json_object)
    let parsed;
    try {
      parsed = JSON.parse(result.text);
    } catch {
      parsed = { articles: [] };
    }

    // Ensure correct shape, sanitize, and cap at 50
    const articles = Array.isArray(parsed.articles) ? parsed.articles : [];
    const clean = articles
      .filter(a => a && typeof a.url === "string" && a.url.startsWith("http"))
      .map(a => ({
        url: a.url,
        title: typeof a.title === "string" ? a.title : ""
      }))
      .slice(0, 50);

    return res.status(200).json({ articles: clean });
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e) });
  }
}

// ---- OpenAI call (Responses API) with deep-research model + fallback ----
async function callOpenAI(prompt) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    return { ok: false, detail: "OPENAI_API_KEY missing in Vercel environment" };
  }

  const endpoint = "https://api.openai.com/v1/responses";
  const headers = {
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json"
  };

  // Try a deep-research model first; if not available, fall back to a standard model.
  const primary = {
    model: "o3-deep-research-2025-06-26",   // or "o4-mini-deep-research-2025-06-26" if your account has it
    input: prompt,
    response_format: { type: "json_object" }
    // Deep-research models have built-in browsing; no extra tools param needed here.
  };

  let resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(primary) });

  if (!resp.ok) {
    const body = await resp.text();
    // If it's a model/permission issue, try a safer fallback to verify plumbing.
    if (/model|not found|permission/i.test(body)) {
      const fallback = {
        model: "gpt-4.1-mini",
        input: prompt,
        response_format: { type: "json_object" }
      };
      resp = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(fallback) });
      if (!resp.ok) {
        return { ok: false, detail: await resp.text() };
      }
    } else {
      return { ok: false, detail: body };
    }
  }

  const data = await resp.json();
  // Prefer the convenience field if present; otherwise drill down.
  const text =
    data?.output_text ||
    data?.output?.[0]?.content?.[0]?.text ||
    "{}";

  return { ok: true, text };
}

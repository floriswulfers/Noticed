// This runs on the SERVER, not in the browser.
// That's what keeps your Anthropic key secret — friends never see it.

const MODELS = [
  "claude-sonnet-4-5-20250929",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet-latest",
];

export async function POST(req) {
  try {
    const { prompt } = await req.json();
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return Response.json({ error: "No API key configured" }, { status: 500 });
    }

    let lastErr = "unknown";

    for (const model of MODELS) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      const data = await res.json();

      if (data.type === "error" || data.error) {
        lastErr = data.error?.message || JSON.stringify(data);
        continue;
      }

      const raw = (data.content || [])
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("")
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      if (raw) return Response.json({ raw });
      lastErr = "empty response";
    }

    return Response.json({ error: lastErr }, { status: 500 });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}

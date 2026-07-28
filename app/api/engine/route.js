// This runs on the SERVER, not in the browser.
// That's what keeps your Anthropic key secret — friends never see it.

export async function POST(req) {
  try {
    const { prompt } = await req.json();
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return Response.json({ error: "No API key configured yet" }, { status: 500 });
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const raw = (data.content || [])
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    return Response.json({ raw });
  } catch (e) {
    console.error(e);
    return Response.json({ error: "engine failed" }, { status: 500 });
  }
}

export async function onRequest(context) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  };

  const reply = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (context.request.method !== "POST") {
    return reply({
      success: false,
      error: "Use a POST request."
    }, 405);
  }

  const apiKey = context.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return reply({
      success: false,
      error: "ANTHROPIC_API_KEY is missing in Cloudflare."
    }, 500);
  }

  try {
    const match = await context.request.json();

    const home = String(match.home || "").trim();
    const away = String(match.away || "").trim();

    if (!home || !away || home.toLowerCase() === away.toLowerCase()) {
      return reply({
        success: false,
        error: "Please provide two different teams."
      }, 400);
    }

    const prompt = `
You are Claude, the football analysis assistant for Browndy Predicts.

Analyze this football match:

Home team: ${home}
Away team: ${away}
Competition: ${match.competition || "Unknown"}
Match date: ${match.matchDate || "Unknown"}

Recent information:
${JSON.stringify(match.recentData || "Not supplied")}

Upcoming matches:
${JSON.stringify(match.upcomingMatches || "Not supplied")}

Return ONLY valid JSON in this format:
{
  "correctScore": "2-1",
  "result": "Home win",
  "doubleChance": "1X",
  "overUnder25": "Over 2.5",
  "btts": "Yes",
  "confidence": "Low",
  "reasoning": "Brief match-specific explanation",
  "limitations": "Missing information"
}

Rules:
- Make predictions specific to the two teams.
- Do not always predict 1-1.
- Make the correct score agree with the predicted result.
- Never invent statistics, injuries or team news.
- Be realistic about uncertainty.
- Predictions are estimates, not guarantees.
`;

    const response = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
         model: "claude-sonnet-5-5",
          max_tokens: 700,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        })
      }
    );

    const raw = await response.text();
    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      return reply({
        success: false,
        error: "Claude returned an unreadable response."
      }, 502);
    }

    if (!response.ok) {
      return reply({
        success: false,
        error: result.error?.message || "Claude request failed."
      }, 502);
    }

    const outputText = result.content
      ?.filter(item => item.type === "text")
      .map(item => item.text)
      .join("");

    if (!outputText) {
      return reply({
        success: false,
        error: "Claude returned no analysis."
      }, 502);
    }

    const cleaned = outputText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    const prediction = JSON.parse(cleaned);

    return reply({
      success: true,
      provider: "Claude",
      prediction
    });

  } catch (error) {
    return reply({
      success: false,
      error: error.message || "Claude analysis failed."
    }, 500);
  }
}

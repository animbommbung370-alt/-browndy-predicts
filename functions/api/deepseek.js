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

  const apiKey = context.env.DEEPSEEK_API_KEY;

  if (!apiKey) {
    return reply({
      success: false,
      error: "DEEPSEEK_API_KEY is missing in Cloudflare."
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
You are DeepSeek, a football analysis assistant for Browndy Predicts.

Analyze this football match:

Home team: ${home}
Away team: ${away}
Competition: ${match.competition || "Unknown"}
Match date: ${match.matchDate || "Unknown"}

Recent information:
${JSON.stringify(match.recentData || "Not supplied")}

Upcoming matches:
${JSON.stringify(match.upcomingMatches || "Not supplied")}

Return ONLY valid JSON:
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
- Give a match-specific prediction.
- Do not always predict 1-1.
- Make the score agree with the predicted result.
- Never invent statistics or injuries.
- Be realistic about uncertainty.
- Predictions are estimates, not guarantees.
`;

    const response = await fetch(
      "https://api.deepseek.com/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "deepseek-flash",
          messages: [
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: {
            type: "json_object"
          },
          max_tokens: 700,
          stream: false
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
        error: "DeepSeek returned an unreadable response."
      }, 502);
    }

    if (!response.ok) {
      return reply({
        success: false,
        error: result.error?.message ||
          "DeepSeek request failed."
      }, 502);
    }

    const outputText = result.choices?.[0]?.message?.content;

    if (!outputText) {
      return reply({
        success: false,
        error: "DeepSeek returned no analysis."
      }, 502);
    }

    const prediction = JSON.parse(outputText);

    return reply({
      success: true,
      provider: "DeepSeek",
      prediction
    });

  } catch (error) {
    return reply({
      success: false,
      error: error.message || "DeepSeek analysis failed."
    }, 500);
  }
}

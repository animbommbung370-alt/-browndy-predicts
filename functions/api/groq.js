export async function onRequest(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  };

  const reply = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers });

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (context.request.method !== "POST") {
    return reply({ success: false, error: "Use a POST request." }, 405);
  }

  const apiKey = context.env.GROQ_API_KEY;

  if (!apiKey) {
    return reply({
      success: false,
      error: "GROQ_API_KEY is missing in Cloudflare."
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

    const recent = JSON.stringify(
      match.recentData || "Not supplied"
    ).slice(0, 3500);

    const upcoming = JSON.stringify(
      match.upcomingMatches || "Not supplied"
    ).slice(0, 1000);

    const prompt = `
You are an independent football analyst for Browndy Predicts.

Analyse this match using the supplied information.

Home: ${home}
Away: ${away}
Competition: ${match.competition || "Unknown"}
Date: ${match.matchDate || "Unknown"}

Recent information:
${recent}

Upcoming matches:
${upcoming}

Return ONLY valid JSON:
{
  "correctScore": "2-1",
  "result": "Home win",
  "doubleChance": "1X",
  "overUnder25": "Over 2.5",
  "btts": "Yes",
  "confidence": "Medium",
  "reasoning": "Brief match-specific explanation",
  "limitations": "Missing information"
}

Rules:
- Make an independent, match-specific prediction.
- Do not always predict 1-1.
- Make the score agree with the result.
- Do not invent injuries or statistics.
- Use Low confidence when information is limited.
- Predictions are estimates, not guarantees.
`;

    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: "openai/gpt-oss-20b",
          messages: [
            {
              role: "system",
              content: "You are a concise football match analyst. Return valid JSON only."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          response_format: {
            type: "json_object"
          },
          reasoning_effort: "low",
          include_reasoning: false,
          max_completion_tokens: 600,
          temperature: 0.2
        }),
        signal: AbortSignal.timeout(20000)
      }
    );

    const raw = await response.text();
    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      return reply({
        success: false,
        error: "Groq returned an unreadable response."
      }, 502);
    }

    if (!response.ok) {
      return reply({
        success: false,
        error: result.error?.message || "Groq request failed."
      }, response.status);
    }

    const text = result.choices?.[0]?.message?.content;

    if (!text) {
      return reply({
        success: false,
        error: "Groq returned no analysis."
      }, 502);
    }

    let prediction;

    try {
      prediction = JSON.parse(text);
    } catch {
      return reply({
        success: false,
        error: "Groq returned invalid prediction data."
      }, 502);
    }

    return reply({
      success: true,
      provider: "Groq",
      model: result.model || "openai/gpt-oss-20b",
      prediction
    });

  } catch (error) {
    return reply({
      success: false,
      error: error.name === "TimeoutError"
        ? "Groq took too long. Please try again."
        : error.message || "Groq analysis failed."
    }, 500);
  }
}

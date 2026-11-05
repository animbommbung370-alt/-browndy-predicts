export async function onRequest(context) {
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  };

  const reply = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: cors });

  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (context.request.method !== "POST") {
    return reply({ success: false, error: "Use a POST request." }, 405);
  }

  const apiKey = context.env.GEMINI_API_KEY;

  if (!apiKey) {
    return reply({
      success: false,
      error: "Gemini API key is missing. Check GEMINI_API_KEY in Cloudflare."
    }, 500);
  }

  try {
    const match = await context.request.json();

    const home = String(match.home || "").trim();
    const away = String(match.away || "").trim();

    if (!home || !away || home.toLowerCase() === away.toLowerCase()) {
      return reply({
        success: false,
        error: "Please provide two different team names."
      }, 400);
    }

    const prompt = `
You are the football analysis engine for Browndy Predicts.

Analyze this match:
Home team: ${home}
Away team: ${away}
Competition: ${match.competition || "Unknown"}
Match date: ${match.matchDate || "Not supplied"}
Recent match information: ${match.recentData || "Not supplied"}
Upcoming matches: ${match.upcomingMatches || "Not supplied"}

Return ONLY valid JSON with these fields:
{
  "home": "${home}",
  "away": "${away}",
  "correctScore": "2-1",
  "result": "Home win, Draw, or Away win",
  "doubleChance": "1X, X2, or 12",
  "overUnder25": "Over 2.5 or Under 2.5",
  "btts": "Yes or No",
  "confidence": "Low, Medium, or High",
  "reasoning": "Brief explanation",
  "limitations": "Missing information"
}

Rules:
- Give a match-specific estimate.
- Do not invent statistics, injuries or recent results.
- Ensure the score agrees with the predicted result.
- Use Low confidence when evidence is limited.
- Predictions are estimates, not guarantees.
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return reply({
        success: false,
        error: result.error?.message || "Gemini request failed."
      }, 502);
    }

    const text = result.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("");

    if (!text) {
      return reply({
        success: false,
        error: "Gemini returned no analysis."
      }, 502);
    }

    const prediction = JSON.parse(text);

    return reply({
      success: true,
      provider: "Google Gemini",
      prediction
    });

  } catch (error) {
    return reply({
      success: false,
      error: error.message || "Gemini analysis failed."
    }, 500);
  }
}

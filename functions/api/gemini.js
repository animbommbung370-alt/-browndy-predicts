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

  const apiKey = context.env.GEMINI_API_KEY;

  if (!apiKey) {
    return reply({
      success: false,
      error: "GEMINI_API_KEY is missing in Cloudflare."
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
You are the football analysis assistant for Browndy Predicts.

Analyze this football match:

Home: ${home}
Away: ${away}
Competition: ${match.competition || "Unknown"}
Date: ${match.matchDate || "Unknown"}

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
  "limitations": "Information that is missing"
}

Rules:
- Give a match-specific prediction.
- Do not always predict 1-1.
- Make the score agree with the predicted result.
- Do not invent injuries or statistics.
- Use Low confidence when information is limited.
- These are estimates, not guarantees.
`;

    const models = [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash"
    ];

    let lastError = "Gemini is temporarily unavailable.";

    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              contents: [
                { parts: [{ text: prompt }] }
              ],
              generationConfig: {
                responseMimeType: "application/json"
              }
            })
          }
        );

        const raw = await response.text();
        let result;

        try {
          result = JSON.parse(raw);
        } catch {
          lastError = "Google returned an unreadable response.";
          continue;
        }

        if (!response.ok) {
          lastError = result.error?.message || "Gemini request failed.";
          continue;
        }

        const text = result.candidates?.[0]?.content?.parts
          ?.map(part => part.text || "")
          .join("");

        if (!text) {
          lastError = "Gemini returned no analysis.";
          continue;
        }

        let prediction;

        try {
          prediction = JSON.parse(text);
        } catch {
          lastError = "Gemini returned invalid prediction data.";
          continue;
        }

        return reply({
          success: true,
          provider: "Google Gemini",
          model,
          prediction
        });

      } catch (error) {
        lastError = error.message || "Connection failed.";
      }
    }

    return reply({
      success: false,
      error: lastError
    }, 503);

  } catch (error) {
    return reply({
      success: false,
      error: error.message || "Gemini analysis failed."
    }, 500);
  }
}

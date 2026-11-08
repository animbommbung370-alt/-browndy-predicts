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

    const recent = JSON.stringify(
      match.recentData || "Not supplied"
    ).slice(0, 3500);

    const upcoming = JSON.stringify(
      match.upcomingMatches || "Not supplied"
    ).slice(0, 1000);

    const prompt = `
You are the football analysis assistant for Browndy Predicts.

Analyse this football match carefully:

Home: ${home}
Away: ${away}
Competition: ${match.competition || "Unknown"}
Date: ${match.matchDate || "Unknown"}

Recent team information:
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
- Give a match-specific prediction.
- Do not always predict 1-1.
- Make the score agree with the predicted result.
- Consider the supplied recent results.
- Do not invent injuries or statistics.
- Use Low confidence when information is limited.
- These are estimates, not guarantees.
- Keep the explanation brief.
`;

    const models = [
      "gemini-3.6-flash",
      "gemini-3.8-flash"
    ];

    let lastError = "Gemini is temporarily unavailable.";

    for (let i = 0; i < models.length; i++) {
      const model = models[i];

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
                responseMimeType: "application/json",
                maxOutputTokens: 400,
                temperature: 0.2
              }
            }),
            signal: AbortSignal.timeout(18000)
          }
        );

        const raw = await response.text();

        let result;

        try {
          result = JSON.parse(raw);
        } catch {
          lastError = "Google returned an unreadable response.";
          break;
        }

        if (!response.ok) {
          lastError = result.error?.message || "Gemini request failed.";

          // Try the backup only for temporary server errors.
          if (response.status >= 500 && i === 0) {
            continue;
          }

          return reply({
            success: false,
            error: lastError
          }, response.status);
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

        let prediction;

        try {
          prediction = JSON.parse(text);
        } catch {
          return reply({
            success: false,
            error: "Gemini returned invalid prediction data."
          }, 502);
        }

        return reply({
          success: true,
          provider: "Google Gemini",
          model,
          prediction
        });

      } catch (error) {
        lastError = error.name === "TimeoutError"
          ? "Gemini took too long. Please try again."
          : error.message || "Connection failed.";

        // Do not wait another 18 seconds after a timeout.
        break;
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

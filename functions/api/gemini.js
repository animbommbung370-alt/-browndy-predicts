export async function onRequest(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    ).slice(0, 2500);

    const upcoming = JSON.stringify(
      match.upcomingMatches || "Not supplied"
    ).slice(0, 700);

    const prompt = `
You are the football analysis assistant for Browndy Predicts.

Analyse this specific football match.

Home: ${home}
Away: ${away}
Competition: ${match.competition || "Unknown"}
Date: ${match.matchDate || "Unknown"}

Recent results:
${recent}

Upcoming matches:
${upcoming}

Give a realistic match-specific prediction.
Do not always predict 1-1.
Make the correct score agree with the predicted result.
Do not invent injuries or statistics.
Use Low confidence when information is limited.
Keep reasoning brief.
Predictions are estimates, not guarantees.
`;

    const schema = {
      type: "OBJECT",
      properties: {
        correctScore: { type: "STRING" },
        result: { type: "STRING" },
        doubleChance: { type: "STRING" },
        overUnder25: { type: "STRING" },
        btts: { type: "STRING" },
        confidence: { type: "STRING" },
        reasoning: { type: "STRING" },
        limitations: { type: "STRING" }
      },
      required: [
        "correctScore",
        "result",
        "doubleChance",
        "overUnder25",
        "btts",
        "confidence",
        "reasoning",
        "limitations"
      ]
    };

    const models = [
      "gemini-3.8-flash",
      "gemini-3.5-flash-lite"
    ];

    let lastError = "Gemini is temporarily unavailable.";

    for (const model of models) {
      let response;

      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            body: JSON.stringify({
              contents: [{
                role: "user",
                parts: [{ text: prompt }]
              }],
              generationConfig: {
                responseMimeType: "application/json",
                responseSchema: schema,
                maxOutputTokens: 700,
                temperature: 0.2
              }
            }),
            signal: AbortSignal.timeout(30000)
          }
        );
      } catch (error) {
        lastError = error.name === "TimeoutError"
          ? "Gemini took too long to respond."
          : "Gemini connection failed.";

        continue;
      }

      const raw = await response.text();
      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        lastError = "Gemini returned an unreadable response.";
        continue;
      }

      if (!response.ok) {
        lastError = data.error?.message ||
          `Gemini request failed (${response.status}).`;

        if (![429, 500, 502, 503, 504].includes(response.status)) {
          break;
        }

        continue;
      }

      const text = data.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

      if (!text) {
        lastError = "Gemini returned an empty response.";
        continue;
      }

      let prediction;

      try {
        prediction = JSON.parse(text);
      } catch {
        lastError = "Gemini returned invalid prediction data.";
        continue;
      }

      const required = [
        "correctScore",
        "result",
        "doubleChance",
        "overUnder25",
        "btts"
      ];

      if (!required.every(key =>
        typeof prediction[key] === "string" &&
        prediction[key].trim()
      )) {
        lastError = "Gemini returned incomplete prediction fields.";
        continue;
      }

      return reply({
        success: true,
        provider: "Google Gemini",
        model,
        prediction: {
          correctScore: prediction.correctScore.trim(),
          result: prediction.result.trim(),
          doubleChance: prediction.doubleChance.trim(),
          overUnder25: prediction.overUnder25.trim(),
          btts: prediction.btts.trim(),
          confidence: prediction.confidence || "Low",
          reasoning: prediction.reasoning || "No explanation supplied.",
          limitations: prediction.limitations || "Information may be limited."
        }
      });
    }

    return reply({
      success: false,
      provider: "Google Gemini",
      error: lastError
    }, 503);

  } catch (error) {
    return reply({
      success: false,
      error: error.message || "Gemini connection failed."
    }, 503);
  }
}

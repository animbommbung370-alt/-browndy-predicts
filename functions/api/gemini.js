export async function onRequest(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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
    return reply({ success: false, error: "GEMINI_API_KEY is missing in Cloudflare." }, 500);
  }

  try {
    const match = await context.request.json();
    const home = String(match.home || "").trim();
    const away = String(match.away || "").trim();

    if (!home || !away || home.toLowerCase() === away.toLowerCase()) {
      return reply({ success: false, error: "Please provide two different teams." }, 400);
    }

    const recent = JSON.stringify(match.recentData || "Not supplied").slice(0, 2500);
    const upcoming = JSON.stringify(match.upcomingMatches || "Not supplied").slice(0, 700);

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

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent",
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
        signal: AbortSignal.timeout(25000)
      }
    );

    const raw = await response.text();
    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return reply({ success: false, error: "Gemini returned an unreadable response." }, 502);
    }

    if (!response.ok) {
      return reply({
        success: false,
        error: data.error?.message || `Gemini request failed (${response.status}).`
      }, response.status === 429 ? 429 : 502);
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();

    if (!text) {
      return reply({ success: false, error: "Gemini returned an empty response." }, 502);
    }

    let prediction;

    try {
      prediction = JSON.parse(text);
    } catch {
      return reply({ success: false, error: "Gemini returned invalid prediction data." }, 502);
    }

    const required = ["correctScore", "result", "doubleChance", "overUnder25", "btts"];

    if (!required.every(key =>
      typeof prediction[key] === "string" && prediction[key].trim()
    )) {
      return reply({ success: false, error: "Gemini returned incomplete prediction fields." }, 502);
    }

    return reply({
      success: true,
      provider: "Google Gemini",
      model: "gemini-3.8-flash",
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

  } catch (error) {
    return reply({
      success: false,
      error: error.message || "Gemini connection failed."
    }, 503);
  }
}

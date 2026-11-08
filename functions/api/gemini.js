export async function onRequest(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  };

const reply = (data, status = 200) =>
new Response(JSON.stringify(data), { status, headers });

if (context.request.method === “OPTIONS”) {
return new Response(null, { status: 204, headers });
}

if (context.request.method !== “POST”) {
return reply({ success: false, error: “Use a POST request.” }, 405);
}

const apiKey = context.env.GEMINI_API_KEY;

if (!apiKey) {
return reply({ success: false, error: “GEMINI_API_KEY is missing in Cloudflare.” }, 500);
}

try {
const match = await context.request.json();
const home = String(match.home || “”).trim();
const away = String(match.away || “”).trim();

if (!home || !away || home.toLowerCase() === away.toLowerCase()) {
  return reply({ success: false, error: "Please provide two different teams." }, 400);
}
const prompt = `

Analyse this football match for Browndy Predicts.

Home: ${home}
Away: ${away}
Competition: ${match.competition || “Unknown”}
Date: ${match.matchDate || “Unknown”}
Recent data: ${JSON.stringify(match.recentData || “Not supplied”).slice(0, 3500)}
Upcoming matches: ${JSON.stringify(match.upcomingMatches || “Not supplied”).slice(0, 1000)}

Return JSON only with these exact fields:
{
“correctScore”: “2-1”,
“result”: “Home win”,
“doubleChance”: “1X”,
“overUnder25”: “Over 2.5”,
“btts”: “Yes”,
“confidence”: “Medium”,
“reasoning”: “Brief match-specific explanation”,
“limitations”: “Missing information”
}

Make the score agree with the result. Do not always predict 1-1. Do not invent statistics or injuries. Use Low confidence when information is limited.
`;

const models = ["gemini-3.8-flash", "gemini-3.6-flash"];
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
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 600,
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
      continue;
    }
    if (!response.ok) {
      lastError = result.error?.message || "Gemini request failed.";
      continue;
    }
    const text = result.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("")
      .trim();
    if (!text) {
      lastError = "Gemini returned no analysis.";
      continue;
    }
    let prediction;
    try {
      const cleaned = text
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
      try {
        prediction = JSON.parse(cleaned);
      } catch {
        const start = cleaned.indexOf("{");
        const end = cleaned.lastIndexOf("}");
        if (start < 0 || end <= start) throw new Error("No JSON found.");
        prediction = JSON.parse(cleaned.slice(start, end + 1));
      }
    } catch {
      lastError = "Gemini's response could not be read as JSON.";
      continue;
    }
    const required = [
      "correctScore",
      "result",
      "doubleChance",
      "overUnder25",
      "btts"
    ];
    if (!prediction || !required.every(key =>
      typeof prediction[key] === "string" && prediction[key].trim()
    )) {
      lastError = "Gemini returned incomplete prediction data.";
      continue;
    }
    return reply({
      success: true,
      provider: "Google Gemini",
      model,
      prediction: {
        correctScore: prediction.correctScore,
        result: prediction.result,
        doubleChance: prediction.doubleChance,
        overUnder25: prediction.overUnder25,
        btts: prediction.btts,
        confidence: prediction.confidence || "Low",
        reasoning: prediction.reasoning || "No explanation supplied.",
        limitations: prediction.limitations || "Information may be limited."
      }
    });
  } catch (error) {
    lastError = error.name === "TimeoutError"
      ? "Gemini took too long. Please try again."
      : "Gemini connection failed.";
  }
}
return reply({ success: false, error: lastError }, 503);

} catch (error) {
return reply({
success: false,
error: error.message || “Gemini analysis failed.”
}, 500);
}
}

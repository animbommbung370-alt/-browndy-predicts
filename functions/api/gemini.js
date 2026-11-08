export async function onRequest(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
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

    if (
      !home ||
      !away ||
      home.toLowerCase() === away.toLowerCase()
    ) {
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

Analyse this football match carefully.

Home: ${home}
Away: ${away}
Competition: ${match.competition || "Unknown"}
Date: ${match.matchDate || "Unknown"}

Recent team information:
${recent}

Upcoming matches:
${upcoming}

Return ONLY a valid JSON object with these exact fields:

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
- Predictions are estimates, not guarantees.
- Keep the explanation brief.
`;

    const models = [
      "gemini-3.8-flash",
      "gemini-3.6-flash"
    ];

    let lastError = "Gemini is temporarily unavailable.";
    let retryUsed = false;

    for (const model of models) {
      let attempts = 0;

      while (attempts < 2) {
        attempts++;

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
                  {
                    role: "user",
                    parts: [{ text: prompt }]
                  }
                ],
                generationConfig: {
                  responseMimeType: "application/json",
                  responseSchema: {
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
                  },
                  maxOutputTokens: 700,
                  temperature: 0.2
                }
              }),
              signal: AbortSignal.timeout(50000)
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
            lastError =
              result.error?.message || "Gemini request failed.";

            const temporary =
              response.status === 429 ||
              response.status === 503 ||
              response.status === 502 ||
              response.status === 408;

            if (temporary && !retryUsed) {
              retryUsed = true;
              await new Promise(resolve =>
                setTimeout(resolve, 1500)
              );
              continue;
            }

            break;
          }

          const text = result.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("")
            .trim();

          if (!text) {
            lastError = "Gemini returned no analysis.";
            break;
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

              if (start === -1 || end <= start) {
                throw new Error("No JSON object found.");
              }

              prediction = JSON.parse(
                cleaned.slice(start, end + 1)
              );
            }
          } catch {
            lastError =
              "Gemini returned unreadable prediction data.";
            break;
          }

          const required = [
            "correctScore",
            "result",
            "doubleChance",
            "overUnder25",
            "btts"
          ];

          const valid = prediction &&
            required.every(key =>
              typeof prediction[key] === "string" &&
              prediction[key].trim().length > 0
            );

          if (!valid) {
            lastError =
              "Gemini returned incomplete prediction data.";
            break;
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
              reasoning:
                prediction.reasoning || "No explanation supplied.",
              limitations:
                prediction.limitations ||
                "Information may be limited."
            }
          });

        } catch (error) {
          lastError = error.name === "TimeoutError"
            ? "Gemini took too long. Please try again."
            : "Gemini connection failed.";

          break;
        }
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

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

Analyse this match using the supplied information.

Home team: ${home}
Away team: ${away}
Competition: ${match.competition || "Unknown"}
Date: ${match.matchDate || "Unknown"}

Recent results:
${recent}

Upcoming matches:
${upcoming}

Return a match-specific prediction.

Requirements:
- Do not always predict 1-1.
- Correct score must agree with the predicted result.
- Use the supplied recent results.
- Do not invent injuries or statistics.
- Use Low confidence when information is limited.
- Keep reasoning brief.
- Predictions are estimates, not guarantees.
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
                contents: [{
                  role: "user",
                  parts: [{ text: prompt }]
                }],
                generationConfig: {
                  responseMimeType: "application/json",
                  responseSchema: schema,
                  maxOutputTokens: 1200,
                  temperature: 0.2
                }
              }),
              signal: AbortSignal.timeout(50000)
            }
          );

          const raw = await response.text();

          let data;

          try {
            data = JSON.parse(raw);
          } catch {
            lastError = "Google returned an unreadable response.";
            break;
          }

          if (!response.ok) {
            lastError = data.error?.message ||
              `Gemini request failed (${response.status}).`;

            const temporary = [429, 502, 503, 408]
              .includes(response.status);

            if (temporary && !retryUsed) {
              retryUsed = true;
              await new Promise(resolve =>
                setTimeout(resolve, 1500)
              );
              continue;
            }

            break;
          }

          const candidate = data.candidates?.[0];

          const text = candidate?.content?.parts
            ?.map(part => part.text || "")
            .join("")
            .trim();

          if (!text) {
            lastError = candidate?.finishReason
              ? `Gemini returned no text. Finish reason: ${candidate.finishReason}.`
              : "Gemini returned an empty response.";

            break;
          }

          let prediction;

          try {
            const cleaned = text
              .replace(/^```(?:json)?\s*/i, "")
              .replace(/\s*```$/i, "")
              .trim();

            prediction = JSON.parse(cleaned);

            // Also accept a JSON object inside surrounding text.
            if (!prediction || typeof prediction !== "object") {
              throw new Error("Invalid prediction object.");
            }
          } catch {
            const start = text.indexOf("{");
            const end = text.lastIndexOf("}");

            if (start !== -1 && end > start) {
              try {
                prediction = JSON.parse(
                  text.slice(start, end + 1)
                );
              } catch {
                lastError =
                  "Gemini returned text that could not be converted into prediction data.";
                break;
              }
            } else {
              lastError =
                "Gemini did not return a valid JSON prediction.";
              break;
            }
          }

          const required = [
            "correctScore",
            "result",
            "doubleChance",
            "overUnder25",
            "btts"
          ];

          const valid = required.every(key =>
            typeof prediction[key] === "string" &&
            prediction[key].trim().length > 0
          );

          if (!valid) {
            lastError =
              "Gemini returned incomplete prediction fields.";
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
              reasoning: prediction.reasoning ||
                "No explanation supplied.",
              limitations: prediction.limitations ||
                "Information may be limited."
            }
          });

        } catch (error) {
          lastError = error.name === "TimeoutError"
            ? "Gemini took too long to respond."
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

const https = require("https");
function sendResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(data)
  };
}
function callGemini(apiKey, prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.3
      }
    });
    const request = https.request(
      {
        hostname: "generativelanguage.googleapis.com",
        path: "/v1beta/models/gemini-2.5-flash:generateContent?key=" +
          encodeURIComponent(apiKey),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 25000
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          let result;
          try {
            result = JSON.parse(data);
          } catch {
            reject(new Error("Gemini returned an unreadable response."));
            return;
          }
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(
              new Error(
                result.error?.message ||
                "Gemini API request failed. Check your API key and model access."
              )
            );
            return;
          }
          const text =
            result.candidates?.[0]?.content?.parts
              ?.map((part) => part.text || "")
              .join("") || "";
          if (!text) {
            reject(new Error("Gemini did not return an analysis."));
            return;
          }
          resolve(text);
        });
      }
    );
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy(new Error("Gemini request timed out. Please try again."));
    });
    request.write(body);
    request.end();
  });
}
exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return sendResponse(200, { success: true });
  }
  if (event.httpMethod !== "POST") {
    return sendResponse(405, {
      success: false,
      error: "Use a POST request."
    });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return sendResponse(500, {
      success: false,
      error: "Gemini API key is missing. Check GEMINI_API_KEY in Netlify."
    });
  }
  let match;
  try {
    match = JSON.parse(event.body || "{}");
  } catch {
    return sendResponse(400, {
      success: false,
      error: "Invalid JSON request."
    });
  }
  const home = String(match.home || "").trim();
  const away = String(match.away || "").trim();
  const competition = String(match.competition || "Unknown competition").trim();
  const recentData = String(match.recentData || "No recent match statistics supplied.");
  if (!home || !away || home.toLowerCase() === away.toLowerCase()) {
    return sendResponse(400, {
      success: false,
      error: "Please provide two different team names."
    });
  }
  const prompt = `
You are the football analysis engine for Browndy Predicts.
Analyze this match:
Home team: ${home}
Away team: ${away}
Competition: ${competition}
Available match information:
${recentData}
Return ONLY valid JSON with these fields:
{
  "home": "${home.replace(/"/g, "'")}",
  "away": "${away.replace(/"/g, "'")}",
  "correctScore": "example: 2-1",
  "result": "Home win, Draw, or Away win",
  "doubleChance": "1X, X2, or 12",
  "overUnder25": "Over 2.5 or Under 2.5",
  "btts": "Yes or No",
  "confidence": "Low, Medium, or High",
  "reasoning": "Brief explanation",
  "limitations": "Important missing information"
}
Rules:
- Give a match-specific estimate, not a guaranteed result.
- Do not claim to have checked live statistics or injuries unless supplied above.
- Do not invent recent results, league positions, injuries, or team statistics.
- Make the score consistent with the predicted result.
- Use Low confidence when evidence is limited.
- Be honest about uncertainty.
`;
  try {
    const analysis = await callGemini(apiKey, prompt);
    let prediction;
    try {
      prediction = JSON.parse(analysis);
    } catch {
      return sendResponse(502, {
        success: false,
        error: "Gemini returned an unexpected format. Please try again."
      });
    }
    return sendResponse(200, {
      success: true,
      provider: "Google Gemini",
      prediction
    });
  } catch (error) {
    console.error("Gemini function error:", error.message);
    return sendResponse(502, {
      success: false,
      error: error.message || "Gemini analysis failed. Please try again."
    });
  }
};

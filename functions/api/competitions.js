import { requirePremium } from "./premium.js";

const API_BASE = "https://api.football-data.org/v4";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return jsonResponse({}, 204);
  }

  if (request.method !== "GET") {
    return jsonResponse({
      success: false,
      error: "Method not allowed."
    }, 405);
  }

  // Require an active Premium subscription.
  const access = await requirePremium(request, env);

  if (!access.allowed) {
    return jsonResponse({
      success: false,
      error: access.error
    }, access.status);
  }

  const token = env.FOOTBALL_DATA_TOKEN;

  if (!token) {
    return jsonResponse({
      success: false,
      error: "Football API token is missing."
    }, 500);
  }

  try {
    const response = await fetch(
      `${API_BASE}/competitions`,
      {
        headers: {
          "X-Auth-Token": token,
          "Accept": "application/json"
        }
      }
    );

    let data;

    try {
      data = await response.json();
    } catch {
      return jsonResponse({
        success: false,
        error: "Invalid response from football API."
      }, 502);
    }

    if (!response.ok) {
      return jsonResponse({
        success: false,
        error: data.message || "Could not load competitions."
      }, response.status);
    }

    const competitions = (data.competitions || []).map(item => ({
      id: item.id,
      name: item.name,
      code: item.code,
      type: item.type,
      area: item.area?.name || "Unknown"
    }));

    return jsonResponse({
      success: true,
      count: competitions.length,
      competitions
    });

  } catch (error) {
    return jsonResponse({
      success: false,
      error: error.message || "Connection failed."
    }, 500);
  }
}

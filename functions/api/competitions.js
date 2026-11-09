const API_BASE = "https://api.football-data.org/v4";

export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
      }
    });
  }

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  };

  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({
      success: false,
      error: "Method not allowed."
    }), { status: 405, headers });
  }

  const token = context.env.FOOTBALL_DATA_TOKEN;

  if (!token) {
    return new Response(JSON.stringify({
      success: false,
      error: "Football API token is missing."
    }), { status: 500, headers });
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

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({
        success: false,
        error: data.message || "Could not load competitions."
      }), { status: response.status, headers });
    }

    const competitions = (data.competitions || []).map(item => ({
      id: item.id,
      name: item.name,
      code: item.code,
      type: item.type,
      area: item.area?.name || "Unknown"
    }));

    return new Response(JSON.stringify({
      success: true,
      count: competitions.length,
      competitions
    }), { status: 200, headers });

  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      error: error.message || "Connection failed."
    }), { status: 500, headers });
  }
}

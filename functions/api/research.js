const ALLOWED_SECTIONS = {
  fixture: (id) => `/fixtures?id=${id}`,
  statistics: (id) => `/fixtures/statistics?fixture=${id}`,
  events: (id) => `/fixtures/events?fixture=${id}`,
  lineups: (id) => `/fixtures/lineups?fixture=${id}`,
  injuries: (id) => `/injuries?fixture=${id}`
};

export async function onRequest(context) {
  const { request, env } = context;

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({
        success: false,
        error: "GET requests only."
      }),
      { status: 405, headers }
    );
  }

  try {
    if (!env.API_FOOTBALL_KEY) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "API-Football key is missing."
        }),
        { status: 500, headers }
      );
    }

    const url = new URL(request.url);
    const fixture = url.searchParams.get("fixture");
    const section = url.searchParams.get("section");

    if (!fixture || !/^\d+$/.test(fixture)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "A valid fixture ID is required."
        }),
        { status: 400, headers }
      );
    }

    if (!section || !ALLOWED_SECTIONS[section]) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Choose one valid section: fixture, statistics, events, lineups or injuries."
        }),
        { status: 400, headers }
      );
    }

    const cache = caches.default;

    const cacheKey = new Request(
      `${url.origin}/api/research?fixture=${fixture}&section=${section}`
    );

    const cached = await cache.match(cacheKey);

    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers
      });
    }

    const apiUrl =
      `https://v3.football.api-sports.io${ALLOWED_SECTIONS[section](fixture)}`;

    const response = await fetch(apiUrl, {
      headers: {
        "x-apisports-key": env.API_FOOTBALL_KEY
      }
    });

    const data = await response.json();

    if (!response.ok || (
      data.errors && Object.keys(data.errors).length > 0
    )) {
      return new Response(
        JSON.stringify({
          success: false,
          fixture,
          section,
          error: data.errors || `API request failed: ${response.status}`
        }),
        { status: response.status || 502, headers }
      );
    }

    const result = {
      success: true,
      fixture,
      section,
      research: {
        [section]: data.response || []
      },
      unavailable: [],
      updatedAt: new Date().toISOString()
    };

    await cache.put(
      cacheKey,
      new Response(JSON.stringify(result), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=900"
        }
      })
    );

    return new Response(JSON.stringify(result), { headers });

  } catch (error) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Research request failed."
      }),
      { status: 500, headers }
    );
  }
}

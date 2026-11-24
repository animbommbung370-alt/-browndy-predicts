const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
      JSON.stringify({ success: false, error: "GET requests only." }),
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

    if (!fixture || !/^\d+$/.test(fixture)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "A valid API-Football fixture ID is required."
        }),
        { status: 400, headers }
      );
    }

    const cache = caches.default;
    const cacheKey = new Request(
      `${url.origin}/api/research?fixture=${fixture}`
    );

    const cached = await cache.match(cacheKey);

    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers
      });
    }

    const endpoints = [
      ["fixture", `/fixtures?id=${fixture}`],
      ["statistics", `/fixtures/statistics?fixture=${fixture}`],
      ["events", `/fixtures/events?fixture=${fixture}`],
      ["lineups", `/fixtures/lineups?fixture=${fixture}`],
      ["injuries", `/injuries?fixture=${fixture}`]
    ];

    const research = {};
    const unavailable = [];

    for (let i = 0; i < endpoints.length; i++) {
      const [name, path] = endpoints[i];

      try {
        const response = await fetch(
          `https://v3.football.api-sports.io${path}`,
          {
            headers: {
              "x-apisports-key": env.API_FOOTBALL_KEY
            }
          }
        );

        const data = await response.json();

        if (!response.ok || (data.errors &&
            Object.keys(data.errors).length > 0)) {
          throw new Error(
            JSON.stringify(data.errors || {
              status: response.status
            })
          );
        }

        research[name] = data.response || [];

      } catch (error) {
        research[name] = [];

        unavailable.push({
          section: name,
          reason: error.message || "Data unavailable"
        });
      }

      if (i < endpoints.length - 1) {
        await wait(2000);
      }
    }

    const result = {
      success: true,
      fixture,
      research,
      unavailable,
      updatedAt: new Date().toISOString()
    };

    const response = new Response(
      JSON.stringify(result),
      { headers }
    );

    await cache.put(
      cacheKey,
      new Response(JSON.stringify(result), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=900"
        }
      })
    );

    return response;

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

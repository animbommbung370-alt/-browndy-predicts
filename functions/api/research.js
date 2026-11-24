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
        JSON.stringify({ success: false, error: "API-Football key is missing." }),
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

    const endpoints = [
      ["fixture", `/fixtures?id=${fixture}`],
      ["statistics", `/fixtures/statistics?fixture=${fixture}`],
      ["events", `/fixtures/events?fixture=${fixture}`],
      ["lineups", `/fixtures/lineups?fixture=${fixture}`],
      ["injuries", `/injuries?fixture=${fixture}`]
    ];

    const results = await Promise.allSettled(
      endpoints.map(async ([name, path]) => {
        const response = await fetch(
          `https://v3.football.api-sports.io${path}`,
          {
            headers: {
              "x-apisports-key": env.API_FOOTBALL_KEY
            }
          }
        );

        if (!response.ok) {
          throw new Error(`${name} request failed: ${response.status}`);
        }

        const data = await response.json();

        if (data.errors && Object.keys(data.errors).length) {
          throw new Error(JSON.stringify(data.errors));
        }

        return { name, data: data.response || [] };
      })
    );

    const research = {};
    const unavailable = [];

    results.forEach((result, index) => {
      const name = endpoints[index][0];

      if (result.status === "fulfilled") {
        research[name] = result.value.data;
      } else {
        research[name] = [];
        unavailable.push({
          section: name,
          reason: result.reason?.message || "Data unavailable"
        });
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        fixture,
        research,
        unavailable,
        updatedAt: new Date().toISOString()
      }),
      { headers }
    );

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

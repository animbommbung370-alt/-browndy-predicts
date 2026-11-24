import { requirePremium } from "./premium.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

function normalize(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(fc|cf|sc|afc|club)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET, OPTIONS"
      }
    });
  }

  if (request.method !== "GET") {
    return json({ success: false, error: "GET requests only." }, 405);
  }

  const access = await requirePremium(request, env);

  if (!access.allowed) {
    return json({
      success: false,
      error: access.error,
      login_required: access.status === 401,
      subscription_required: access.status === 403
    }, access.status);
  }

  if (!env.API_FOOTBALL_KEY) {
    return json({
      success: false,
      error: "API-Football key is missing."
    }, 500);
  }

  const url = new URL(request.url);
  const home = url.searchParams.get("home");
  const away = url.searchParams.get("away");
  const date = url.searchParams.get("date");

  if (!home || !away || !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({
      success: false,
      error: "Home team, away team and date are required."
    }, 400);
  }

  try {
    const cache = caches.default;
    const cacheKey = new Request(
      `${url.origin}/api/research-match?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}&date=${date}`
    );

    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    const apiUrl = new URL(
      "https://v3.football.api-sports.io/fixtures"
    );
    apiUrl.searchParams.set("date", date);

    const response = await fetch(apiUrl, {
      headers: {
        "x-apisports-key": env.API_FOOTBALL_KEY
      }
    });

    const data = await response.json();

    if (!response.ok ||
        (data.errors && Object.keys(data.errors).length)) {
      return json({
        success: false,
        error: data.errors || "API-Football request failed."
      }, response.status || 502);
    }

    const wantedHome = normalize(home);
    const wantedAway = normalize(away);

    const candidates = (data.response || []).filter(item =>
      normalize(item.teams?.home?.name) === wantedHome &&
      normalize(item.teams?.away?.name) === wantedAway
    );

    if (candidates.length === 0) {
      return json({
        success: false,
        error: "No exact team match found for this date.",
        home,
        away,
        date
      }, 404);
    }

    const result = {
      success: true,
      fixture: candidates[0].fixture.id,
      home: candidates[0].teams.home.name,
      away: candidates[0].teams.away.name,
      date: candidates[0].fixture.date,
      competition: candidates[0].league.name
    };

    await cache.put(cacheKey, new Response(
      JSON.stringify(result),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=21600"
        }
      }
    ));

    return json(result);

  } catch (error) {
    return json({
      success: false,
      error: error.message || "Fixture matching failed."
    }, 500);
  }
}

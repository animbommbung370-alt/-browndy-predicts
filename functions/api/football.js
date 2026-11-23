import { requirePremium } from "./premium.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

function formatMatch(match) {
  return {
    id: match.id,
    utcDate: match.utcDate,
    date: match.utcDate,
    status: match.status,
    matchday: match.matchday,
    competition: match.competition?.name || "",
    homeTeam: {
      id: match.homeTeam?.id,
      name: match.homeTeam?.name || "",
      crest: match.homeTeam?.crest || ""
    },
    awayTeam: {
      id: match.awayTeam?.id,
      name: match.awayTeam?.name || "",
      crest: match.awayTeam?.crest || ""
    },
    score: match.score
  };
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
    return json({ error: "Method not allowed." }, 405);
  }

  const access = await requirePremium(request, env);

  if (!access.allowed) {
    return json({
      success: false,
      error: access.error,
      subscription_required: access.status === 403,
      login_required: access.status === 401
    }, access.status);
  }

  const token = env.FOOTBALL_DATA_TOKEN;

  if (!token) {
    return json({
      success: false,
      error: "Football data token is missing."
    }, 500);
  }

  const now = new Date();

  const headers = {
    "X-Auth-Token": token
  };

  async function fetchMatches(dateFrom, dateTo, status) {
    const url = new URL(
      "https://api.football-data.org/v4/matches"
    );

    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);

    if (status) {
      url.searchParams.set("status", status);
    }

    const response = await fetch(url, {
      headers,
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(
        `Football data error: ${response.status}`
      );
    }

    const data = await response.json();

    return (data.matches || []).map(formatMatch);
  }

  try {
    const upcomingRanges = [];

    for (let i = 0; i < 30; i += 10) {
      const start = new Date(
        now.getTime() + i * 86400000
      );

      const end = new Date(
        now.getTime() + (i + 9) * 86400000
      );

      upcomingRanges.push(
        fetchMatches(
          start.toISOString().slice(0, 10),
          end.toISOString().slice(0, 10)
        )
      );
    }

    const recentRanges = [];

    for (let i = 0; i < 60; i += 10) {
      const start = new Date(
        now.getTime() - (i + 9) * 86400000
      );

      const end = new Date(
        now.getTime() - i * 86400000
      );

      recentRanges.push(
        fetchMatches(
          start.toISOString().slice(0, 10),
          end.toISOString().slice(0, 10),
          "FINISHED"
        )
      );
    }

    const allResults = await Promise.allSettled([
      ...upcomingRanges,
      ...recentRanges
    ]);

    const matches = allResults
      .slice(0, 3)
      .filter(result => result.status === "fulfilled")
      .flatMap(result => result.value);

    const recentMatches = allResults
      .slice(3)
      .filter(result => result.status === "fulfilled")
      .flatMap(result => result.value);

    const uniqueUpcoming = Array.from(
      new Map(
        matches.map(match => [match.id, match])
      ).values()
    );

    const uniqueRecent = Array.from(
      new Map(
        recentMatches.map(match => [match.id, match])
      ).values()
    );

    return json({
      success: true,
      matches: uniqueUpcoming,
      recentMatches: uniqueRecent,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error("Football API error:", error);

    return json({
      success: false,
      error: "Unable to load matches."
    }, 500);
  }
}

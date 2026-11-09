const API_BASE = "https://api.football-data.org/v4";
async function apiRequest(url, token) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      headers: {
        "X-Auth-Token": token,
        Accept: "application/json"
      },
      signal: controller.signal
    });
    let parsed;
    try {
      parsed = await response.json();
    } catch {
      throw new Error("Invalid response from football API");
    }
    if (!response.ok) {
      throw new Error(
        parsed.message || "Football API request failed"
      );
    }
    return parsed;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Football API request timed out");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function formatMatch(match) {
  const homeScore = match.score?.fullTime?.home ?? null;
  const awayScore = match.score?.fullTime?.away ?? null;
  return {
    id: match.id,
    utcDate: match.utcDate,
    date: match.utcDate,
    status: match.status,
    matchday: match.matchday ?? null,
    competition: match.competition?.name ?? "Unknown competition",
    homeTeam: match.homeTeam?.name ?? "Home team",
    awayTeam: match.awayTeam?.name ?? "Away team",
    homeTeamName: match.homeTeam?.name ?? "Home team",
    awayTeamName: match.awayTeam?.name ?? "Away team",
    homeCrest: match.homeTeam?.crest ?? "",
    awayCrest: match.awayTeam?.crest ?? "",
    score: {
      home: homeScore,
      away: awayScore
    },
    homeScore,
    awayScore
  };
}
function dateString(date) {
  return date.toISOString().slice(0, 10);
}
function shiftDate(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
export async function onRequest(context) {
  if (context.request.method === "OPTIONS") {
    return jsonResponse({}, 204);
  }
  if (!["GET", "POST"].includes(context.request.method)) {
    return jsonResponse({
      success: false,
      error: "Method not allowed."
    }, 405);
  }
  const token = context.env.FOOTBALL_DATA_TOKEN;
  if (!token) {
    return jsonResponse({
      success: false,
      error: "Football API token is missing. Check FOOTBALL_DATA_TOKEN in Cloudflare."
    }, 500);
  }
  try {
    const today = new Date();
    // Split the next 30 days into three requests.
    const upcomingRanges = [];
    for (let i = 0; i < 3; i++) {
      const startDay = i * 10;
      const endDay = startDay + 9;
      upcomingRanges.push({
        from: dateString(shiftDate(today, startDay)),
        to: dateString(shiftDate(today, endDay))
      });
    }
    const upcomingRequests = upcomingRanges.map(range => {
      const url =
        `${API_BASE}/matches?dateFrom=${range.from}&dateTo=${range.to}`;
      return apiRequest(url, token);
    });
    // Load recent completed matches in four date ranges.
    const recentRanges = [];
    let rangeEnd = today;
    for (let i = 0; i < 4; i++) {
      const rangeStart = shiftDate(rangeEnd, -8);
      recentRanges.push({
        from: dateString(rangeStart),
        to: dateString(rangeEnd)
      });
      rangeEnd = shiftDate(rangeStart, -1);
    }
    const recentRequests = recentRanges.map(range => {
      const url =
        `${API_BASE}/matches?dateFrom=${range.from}&dateTo=${range.to}&status=FINISHED`;
      return apiRequest(url, token);
    });
    const results = await Promise.allSettled([
      ...upcomingRequests,
      ...recentRequests
    ]);
    // Process upcoming fixtures from all three requests.
    const upcomingResults = results.slice(0, 3);
    const successfulUpcomingResults = upcomingResults
      .filter(result => result.status === "fulfilled");
    const upcomingAvailable =
      successfulUpcomingResults.length > 0;
    const upcomingErrors = upcomingResults
      .filter(result => result.status === "rejected")
      .map(result => result.reason?.message || "Unknown fixture error");
    let upcomingMatches = [];
    for (const result of successfulUpcomingResults) {
      upcomingMatches = upcomingMatches.concat(
        result.value.matches || []
      );
    }
    const uniqueUpcomingMatches = Array.from(
      new Map(
        upcomingMatches.map(match => [match.id, match])
      ).values()
    );
    upcomingMatches = uniqueUpcomingMatches
      .filter(match =>
        ["SCHEDULED", "TIMED"].includes(match.status)
      )
      .map(formatMatch)
      .sort((a, b) =>
        new Date(a.utcDate) - new Date(b.utcDate)
      );
    // Process recent results.
    const successfulRecentResults = results
      .slice(3)
      .filter(result => result.status === "fulfilled");
    const recentResultsAvailable =
      successfulRecentResults.length > 0;
    let recentMatches = [];
    for (const result of successfulRecentResults) {
      recentMatches = recentMatches.concat(
        result.value.matches || []
      );
    }
    const uniqueRecentMatches = Array.from(
      new Map(
        recentMatches.map(match => [match.id, match])
      ).values()
    );
    recentMatches = uniqueRecentMatches
      .filter(match =>
        ["FINISHED", "AWARDED"].includes(match.status)
      )
      .map(formatMatch)
      .sort((a, b) =>
        new Date(b.utcDate) - new Date(a.utcDate)
      );
    const failedRecentRequests =
      recentRequests.length - successfulRecentResults.length;
    return jsonResponse({
      success: upcomingAvailable || recentResultsAvailable,
      provider: "Football-Data.org",
      matches: upcomingMatches,
      recentMatches,
      upcomingAvailable,
      upcomingError: upcomingErrors.length
        ? upcomingErrors.join("; ")
        : null,
      upcomingRequestsSuccessful:
        successfulUpcomingResults.length,
      recentResultsAvailable,
      statisticsAvailable: false,
      recentMatchesCount: recentMatches.length,
      upcomingMessage: upcomingAvailable
        ? `${upcomingMatches.length} upcoming matches loaded for the next 30 days.`
        : "Upcoming matches could not be loaded. Please try again later.",
      recentResultsMessage: recentResultsAvailable
        ? `${recentMatches.length} recent results loaded.` +
          (failedRecentRequests > 0
            ? ` ${failedRecentRequests} recent-results requests failed.`
            : "")
        : "Recent results could not be loaded. Please check your API plan and try again.",
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error.message || "Football API request failed."
    }, 500);
  }
}

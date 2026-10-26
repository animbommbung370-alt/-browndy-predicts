const https = require("https");

const API_BASE = "https://api.football-data.org/v4";

function apiRequest(url, token) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          "X-Auth-Token": token,
          Accept: "application/json"
        },
        timeout: 12000
      },
      (response) => {
        let body = "";

        response.setEncoding("utf8");

        response.on("data", (chunk) => {
          body += chunk;
        });

        response.on("end", () => {
          let data;

          try {
            data = JSON.parse(body);
          } catch {
            reject(new Error("Football data returned an invalid response."));
            return;
          }

          if (
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            const error = new Error(
              data.message ||
              "Football data request failed."
            );

            error.statusCode = response.statusCode;
            reject(error);
            return;
          }

          resolve(data);
        });
      }
    );

    request.setTimeout(12000, () => {
      request.destroy(new Error("Football data request timed out."));
    });

    request.on("error", reject);
  });
}

function formatMatch(match) {
  return {
    id: match.id,
    utcDate: match.utcDate,
    date: match.utcDate,
    status: match.status,
    matchday: match.matchday,
    competition: match.competition
      ? match.competition.name
      : "Football",
    homeTeam: match.homeTeam
      ? match.homeTeam.name
      : "Home team",
    awayTeam: match.awayTeam
      ? match.awayTeam.name
      : "Away team",
    homeTeamName: match.homeTeam
      ? match.homeTeam.name
      : "Home team",
    awayTeamName: match.awayTeam
      ? match.awayTeam.name
      : "Away team",
    homeCrest: match.homeTeam
      ? match.homeTeam.crest
      : null,
    awayCrest: match.awayTeam
      ? match.awayTeam.crest
      : null,
    score: match.score || null,
    homeScore: match.score &&
      match.score.fullTime
        ? match.score.fullTime.home
        : null,
    awayScore: match.score &&
      match.score.fullTime
        ? match.score.fullTime.away
        : null
  };
}

exports.handler = async function () {
  const token = process.env.FOOTBALL_DATA_TOKEN;

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };

  function respond(statusCode, data) {
    return {
      statusCode,
      headers,
      body: JSON.stringify(data)
    };
  }

  if (!token) {
    return respond(500, {
      error: "Missing Football-Data.org API token.",
      message: "Check the FOOTBALL_DATA_TOKEN environment variable."
    });
  }

  const today = new Date();

  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + 7);

  const pastDate = new Date(today);
  pastDate.setDate(pastDate.getDate() - 30);

  const dateString = (date) =>
    date.toISOString().slice(0, 10);

  const upcomingUrl =
    API_BASE +
    "/matches?dateFrom=" +
    dateString(today) +
    "&dateTo=" +
    dateString(futureDate);

  const recentUrl =
    API_BASE +
    "/matches?dateFrom=" +
    dateString(pastDate) +
    "&dateTo=" +
    dateString(today);

  try {
    const results = await Promise.allSettled([
      apiRequest(upcomingUrl, token),
      apiRequest(recentUrl, token)
    ]);

    const upcomingResult = results[0];
    const recentResult = results[1];

    if (
      upcomingResult.status === "rejected" &&
      recentResult.status === "rejected"
    ) {
      const error = upcomingResult.reason;

      console.error(
        "Upcoming matches error:",
        error.message
      );

      console.error(
        "Recent results error:",
        recentResult.reason.message
      );

      const statusCode =
        error.statusCode === 429 ? 429 :
        error.statusCode === 403 ? 502 :
        502;

      return respond(statusCode, {
        error: "Could not load football data.",
        message:
          error.statusCode === 429
            ? "The football API request limit was reached."
            : "Check the API token and Football-Data.org access."
      });
    }

    let matches = [];
    let recentMatches = [];
    let upcomingAvailable = false;
    let recentResultsAvailable = false;
    let upcomingMessage = "";
    let recentResultsMessage = "";

    if (upcomingResult.status === "fulfilled") {
      matches = (upcomingResult.value.matches || [])
        .filter((match) =>
          ["SCHEDULED", "TIMED"].includes(match.status)
        )
        .map(formatMatch);

      upcomingAvailable = true;
    } else {
      upcomingMessage = upcomingResult.reason.message;

      console.error(
        "Upcoming matches unavailable:",
        upcomingMessage
      );
    }

    if (recentResult.status === "fulfilled") {
      recentMatches = (recentResult.value.matches || [])
        .filter((match) =>
          ["FINISHED", "AWARDED"].includes(match.status)
        )
        .map(formatMatch);

      recentResultsAvailable = true;
    } else {
      recentResultsMessage = recentResult.reason.message;

      console.error(
        "Recent results unavailable:",
        recentResultsMessage
      );
    }

    matches.sort(
      (a, b) => new Date(a.utcDate) - new Date(b.utcDate)
    );

    recentMatches.sort(
      (a, b) => new Date(b.utcDate) - new Date(a.utcDate)
    );

    return respond(200, {
      success: true,
      provider: "Football-Data.org",
      matches: matches,
      recentMatches: recentMatches,
      upcomingAvailable: upcomingAvailable,
      recentResultsAvailable: recentResultsAvailable,
      statisticsAvailable: recentResultsAvailable,
      recentMatchesCount: recentMatches.length,
      upcomingMessage: upcomingMessage,
      recentResultsMessage: recentResultsMessage,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error("Football function error:", error.message);

    return respond(500, {
      error: "An unexpected error occurred.",
      message: "Please try loading matches again."
    });
  }
};

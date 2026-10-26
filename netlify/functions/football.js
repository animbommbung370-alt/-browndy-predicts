exports.handler = async function () {
  const token = process.env.FOOTBALL_DATA_TOKEN;

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };

  if (!token) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: "Football data token is missing"
      })
    };
  }

  try {
    const now = new Date();

    const dateString = date => date.toISOString().slice(0, 10);

    const today = dateString(now);

    const yesterdayDate = new Date(now);
    yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);

    const futureDate = new Date(now);
    futureDate.setUTCDate(futureDate.getUTCDate() + 10);

    const pastDate = new Date(now);
    pastDate.setUTCDate(pastDate.getUTCDate() - 10);

    async function getMatches(from, to) {
      const url = new URL(
        "https://api.football-data.org/v4/matches"
      );

      url.searchParams.set("dateFrom", from);
      url.searchParams.set("dateTo", to);

      const response = await fetch(url.toString(), {
        headers: {
          "X-Auth-Token": token,
          "Accept": "application/json"
        }
      });

      const text = await response.text();

      let data;

      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          "The football data provider returned an unreadable response."
        );
      }

      if (!response.ok) {
        throw new Error(
          data.message ||
          `Football data service returned error ${response.status}.`
        );
      }

      return Array.isArray(data.matches) ? data.matches : [];
    }

    const [upcomingMatches, recentMatches] = await Promise.all([
      getMatches(today, dateString(futureDate)),
      getMatches(dateString(pastDate), dateString(yesterdayDate))
    ]);

    const finishedMatches = recentMatches.filter(match =>
      ["FINISHED", "AWARDED"].includes(match.status) &&
      match.score?.fullTime?.home != null &&
      match.score?.fullTime?.away != null
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        matches: upcomingMatches,
        recentMatches: finishedMatches,
        statisticsAvailable: finishedMatches.length > 0,
        recentMatchesCount: finishedMatches.length,
        message: "Fixture and recent-results request completed."
      })
    };

  } catch (error) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({
        error: error.message ||
          "Could not load football data."
      })
    };
  }
};

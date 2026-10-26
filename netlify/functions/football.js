exports.handler = async function () {
const token = process.env.FOOTBALL_DATA_TOKEN;

const headers = {
“Content-Type”: “application/json; charset=utf-8”,
“Cache-Control”: “no-store”
};

if (!token) {
return {
statusCode: 500,
headers,
body: JSON.stringify({
error: “Football data token is missing.”
})
};
}

const dateString = date =>
date.toISOString().slice(0, 10);

async function getMatches(from, to) {
const url = new URL(
“https://api.football-data.org/v4/matches”
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
  throw new Error("Invalid response from football data service.");
}
if (!response.ok) {
  throw new Error(
    data.message ||
    `Football data service error ${response.status}.`
  );
}
return Array.isArray(data.matches)
  ? data.matches
  : [];

}

try {
const now = new Date();

const today = dateString(now);
const futureDate = new Date(now);
futureDate.setUTCDate(futureDate.getUTCDate() + 10);
const pastDate = new Date(now);
pastDate.setUTCDate(pastDate.getUTCDate() - 30);
const yesterdayDate = new Date(now);
yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
// Request fixtures and recent results in parallel.
// If recent results fail, upcoming fixtures can still load.
const results = await Promise.allSettled([
  getMatches(today, dateString(futureDate)),
  getMatches(dateString(pastDate), dateString(yesterdayDate))
]);
if (results[0].status === "rejected") {
  throw new Error(
    results[0].reason?.message ||
    "Could not load upcoming fixtures."
  );
}
const upcomingMatches = results[0].value;
const recentRequestSucceeded =
  results[1].status === "fulfilled";
const recentMatches = recentRequestSucceeded
  ? results[1].value
  : [];
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
    recentResultsAvailable: recentRequestSucceeded,
    recentResultsMessage: recentRequestSucceeded
      ? "Recent results loaded."
      : "Fixtures loaded, but recent results are temporarily unavailable.",
    message: "Football data request completed."
  })
};

} catch (error) {
return {
statusCode: 502,
headers,
body: JSON.stringify({
error: error.message ||
“Could not load football data.”
})
};
}
};

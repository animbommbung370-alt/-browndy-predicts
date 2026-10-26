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
      body: JSON.stringify({ error: "Football data token is missing" })
    };
  }

  try {
    const response = await fetch("https://api.football-data.org/v4/matches", {
      headers: { "X-Auth-Token": token }
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); }
    catch { data = { error: "The football data provider returned an unreadable response" }; }

    return {
      statusCode: response.status,
      headers,
      body: JSON.stringify(data)
    };
  } catch (error) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: "Could not load matches from the football data provider" })
    };
  }
};

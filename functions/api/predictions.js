import { requirePremium } from "./premium.js";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });

export async function onRequestGet({ request, env }) {
  const access = await requirePremium(request, env);

  if (!access.allowed) {
    return json({ error: access.error }, access.status);
  }

  try {
    const predictions = await env.DB.prepare(`
      SELECT *
      FROM predictions
      WHERE customer_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).bind(access.customer.id).all();

    return json({
      success: true,
      predictions: predictions.results || []
    });
  } catch (error) {
    console.error("Load predictions error:", error);
    return json({
      success: false,
      error: "Unable to load predictions."
    }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const access = await requirePremium(request, env);

  if (!access.allowed) {
    return json({ error: access.error }, access.status);
  }

  try {
    const body = await request.json();

    const matchId = String(body.match_id || "").trim();
    const home = String(body.home_team || "").trim();
    const away = String(body.away_team || "").trim();

    if (!matchId || !home || !away) {
      return json({
        success: false,
        error: "A match ID and both team names are required."
      }, 400);
    }

    const result = await env.DB.prepare(`
      INSERT INTO predictions (
        customer_id,
        match_id,
        home_team,
        away_team,
        competition,
        kickoff,
        predicted_score,
        predicted_outcome,
        predicted_double_chance,
        predicted_goals,
        predicted_btts
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      access.customer.id,
      matchId,
      home,
      away,
      body.competition || null,
      body.kickoff || null,
      body.predicted_score || null,
      body.predicted_outcome || null,
      body.predicted_double_chance || null,
      body.predicted_goals || null,
      body.predicted_btts || null
    ).run();

    return json({
      success: true,
      message: "Prediction saved successfully.",
      id: result.meta?.last_row_id
    });
  } catch (error) {
    console.error("Save prediction error:", error);
    return json({
      success: false,
      error: "Unable to save prediction."
    }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB || !env.ADMIN_SECRET) {
      return json({ error: "Server configuration is incomplete." }, 500);
    }

    const auth = request.headers.get("Authorization") || "";
    const suppliedSecret = auth.startsWith("Bearer ")
      ? auth.slice(7)
      : "";

    if (suppliedSecret !== env.ADMIN_SECRET) {
      return json({ error: "Unauthorized." }, 401);
    }

    const body = await request.json();
    const transactionId = String(body.transaction_id || "").trim();
    const action = String(body.action || "").trim().toLowerCase();

    if (!transactionId) {
      return json({ error: "Transaction ID is required." }, 400);
    }

    if (!["approve", "reject"].includes(action)) {
      return json({ error: "Action must be approve or reject." }, 400);
    }

    const payment = await env.DB.prepare(`
      SELECT id, user_id, status
      FROM payment_requests
      WHERE transaction_id = ?
      LIMIT 1
    `).bind(transactionId).first();

    if (!payment) {
      return json({ error: "Payment request not found." }, 404);
    }

    if (payment.status !== "pending") {
      return json({ error: "This request has already been processed." }, 409);
    }

    if (action === "approve") {
      if (!payment.user_id) {
        return json({
          error: "This payment is not linked to a customer account."
        }, 400);
      }

      const approvedAt = new Date().toISOString();

      const update = await env.DB.prepare(`
        UPDATE payment_requests
        SET status = 'approved',
            approved_at = ?,
            expires_at = datetime('now', '+30 days')
        WHERE id = ? AND status = 'pending'
      `).bind(approvedAt, payment.id).run();

      if (!update.meta.changes) {
        return json({
          error: "This request has already been processed."
        }, 409);
      }

      await env.DB.prepare(`
        UPDATE customers
        SET premium_until = datetime(
          CASE
            WHEN premium_until IS NOT NULL
              AND premium_until > CURRENT_TIMESTAMP
            THEN premium_until
            ELSE CURRENT_TIMESTAMP
          END,
          '+30 days'
        )
        WHERE id = ?
      `).bind(payment.user_id).run();

      const customer = await env.DB.prepare(`
        SELECT premium_until
        FROM customers
        WHERE id = ?
      `).bind(payment.user_id).first();

      return json({
        success: true,
        status: "approved",
        premium_until: customer.premium_until
      });
    }

    await env.DB.prepare(`
      UPDATE payment_requests
      SET status = 'rejected'
      WHERE id = ? AND status = 'pending'
    `).bind(payment.id).run();

    return json({
      success: true,
      status: "rejected"
    });

  } catch (error) {
    return json({ error: "Unable to process this request." }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

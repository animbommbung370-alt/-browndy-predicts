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
      SELECT id, status
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
      const approvedAt = new Date();
      const expiresAt = new Date(
        approvedAt.getTime() + 30 * 24 * 60 * 60 * 1000
      );

      await env.DB.prepare(`
        UPDATE payment_requests
        SET status = 'approved',
            approved_at = ?,
            expires_at = ?
        WHERE id = ? AND status = 'pending'
      `).bind(
        approvedAt.toISOString(),
        expiresAt.toISOString(),
        payment.id
      ).run();

      return json({
        success: true,
        status: "approved",
        expires_at: expiresAt.toISOString()
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

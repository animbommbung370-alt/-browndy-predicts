export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: "Payment database is not connected." }, 500);
    }

    const body = await request.json();

    const customerName = String(body.customer_name || "").trim();
    const phoneNumber = String(body.phone_number || "").trim();
    const transactionId = String(body.transaction_id || "").trim();

    if (!customerName || !phoneNumber || !transactionId) {
      return json({
        error: "Please provide your name, phone number and transaction ID."
      }, 400);
    }

    if (
      customerName.length > 100 ||
      phoneNumber.length > 30 ||
      transactionId.length > 100
    ) {
      return json({ error: "One or more details are too long." }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO payment_requests
      (customer_name, phone_number, transaction_id, status)
      VALUES (?, ?, ?, 'pending')
    `).bind(customerName, phoneNumber, transactionId).run();

    return json({
      success: true,
      status: "pending",
      message: "Your payment request has been submitted for manual verification."
    }, 201);

  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      return json({
        error: "This transaction ID has already been submitted."
      }, 409);
    }

    return json({ error: "Unable to submit payment request." }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: "Payment database is not connected." }, 500);
    }

    const url = new URL(request.url);
    const transactionId = String(
      url.searchParams.get("transaction_id") || ""
    ).trim();

    if (!transactionId) {
      return json({ error: "Transaction ID is required." }, 400);
    }

    const payment = await env.DB.prepare(`
      SELECT status, expires_at
      FROM payment_requests
      WHERE transaction_id = ?
      LIMIT 1
    `).bind(transactionId).first();

    if (!payment) {
      return json({ error: "Payment request not found." }, 404);
    }

    return json({
      status: payment.status,
      expires_at: payment.expires_at
    });

  } catch (error) {
    return json({ error: "Unable to check payment status." }, 500);
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

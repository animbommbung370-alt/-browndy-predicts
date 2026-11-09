async function getCustomer(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  if (!token || token.length > 200) return null;

  const result = await env.DB.prepare(`
    SELECT c.id, c.phone_number
    FROM customer_sessions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.token_hash = ?
      AND s.expires_at > ?
    LIMIT 1
  `).bind(
    await sha256(token),
    new Date().toISOString()
  ).first();

  return result || null;
}

async function sha256(value) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
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

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: "Database is unavailable." }, 500);
    }

    const customer = await getCustomer(request, env);

    if (!customer) {
      return json({ error: "Please log in first." }, 401);
    }

    const body = await request.json();

    const customerName = String(body.customer_name || "").trim();
    const transactionId = String(body.transaction_id || "").trim();

    if (!customerName || !transactionId) {
      return json({
        error: "Please provide your name and transaction ID."
      }, 400);
    }

    if (customerName.length > 100 || transactionId.length > 100) {
      return json({ error: "Your details are too long." }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO payment_requests
      (customer_name, phone_number, transaction_id, status, user_id)
      VALUES (?, ?, ?, 'pending', ?)
    `).bind(
      customerName,
      customer.phone_number,
      transactionId,
      customer.id
    ).run();

    return json({
      success: true,
      status: "pending",
      message: "Your payment request has been submitted for verification."
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
      return json({ error: "Database is unavailable." }, 500);
    }

    const customer = await getCustomer(request, env);

    if (!customer) {
      return json({ error: "Please log in first." }, 401);
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
        AND user_id = ?
      LIMIT 1
    `).bind(transactionId, customer.id).first();

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

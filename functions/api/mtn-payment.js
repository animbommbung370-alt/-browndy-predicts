async function getCustomer(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ")
    ? auth.slice(7).trim()
    : "";

  if (!token || token.length > 200) return null;

  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  const tokenHash = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  return await env.DB.prepare(`
    SELECT c.id, c.phone_number
    FROM customer_sessions s
    JOIN customers c ON c.id = s.customer_id
    WHERE s.token_hash = ?
      AND s.expires_at > ?
    LIMIT 1
  `).bind(tokenHash, new Date().toISOString()).first();
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

function normalizePhone(value) {
  const phone = String(value || "").replace(/\D/g, "");

  const msisdn = phone.startsWith("237")
    ? phone
    : "237" + phone;

  return /^2376\d{8}$/.test(msisdn) ? msisdn : null;
}

async function getMtnToken(env) {
  const credentials = btoa(
    `${env.MTN_API_USER_ID}:${env.MTN_API_KEY}`
  );

  const response = await fetch(
    "https://sandbox.momodeveloper.mtn.com/collection/token/",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Ocp-Apim-Subscription-Key": env.MTN_SUBSCRIPTION_KEY,
        "X-Target-Environment": "sandbox"
      }
    }
  );

  if (!response.ok) {
    throw new Error("MTN authentication failed.");
  }

  const data = await response.json();

  return data.access_token;
}

function checkConfiguration(env) {
  return Boolean(
    env.DB &&
    env.MTN_SUBSCRIPTION_KEY &&
    env.MTN_API_USER_ID &&
    env.MTN_API_KEY
  );
}

export async function onRequestPost({ request, env }) {
  try {
    if (!checkConfiguration(env)) {
      return json({
        error: "Payment system configuration is incomplete."
      }, 500);
    }

    const customer = await getCustomer(request, env);

    if (!customer) {
      return json({ error: "Please log in first." }, 401);
    }

    const body = await request.json();

    const msisdn = normalizePhone(
      body.phoneNumber || customer.phone_number
    );

    if (!msisdn) {
      return json({
        error: "Enter a valid Cameroon MTN number."
      }, 400);
    }

    const accessToken = await getMtnToken(env);
    const referenceId = crypto.randomUUID();

    // Save the payment request before asking MTN to collect payment.
    await env.DB.prepare(`
      INSERT INTO payment_requests (
        customer_name,
        phone_number,
        transaction_id,
        status,
        user_id,
        mtn_reference,
        amount,
        currency,
        payer_msisdn,
        provider_status
      )
      VALUES (?, ?, ?, 'pending', ?, ?, 5000, 'XAF', ?, 'PENDING')
    `).bind(
      customer.phone_number,
      customer.phone_number,
      referenceId,
      customer.id,
      referenceId,
      msisdn
    ).run();

    const paymentResponse = await fetch(
      "https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Reference-Id": referenceId,
          "X-Target-Environment": "sandbox",
          "Ocp-Apim-Subscription-Key": env.MTN_SUBSCRIPTION_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          amount: "5000",
          currency: "XAF",
          externalId: referenceId,
          payer: {
            partyIdType: "MSISDN",
            partyId: msisdn
          },
          payerMessage: "Browndy Predicts Premium",
          payeeNote: "Monthly subscription"
        })
      }
    );

    if (paymentResponse.status !== 202) {
      await env.DB.prepare(`
        UPDATE payment_requests
        SET status = 'rejected',
            provider_status = 'REQUEST_FAILED'
        WHERE mtn_reference = ?
      `).bind(referenceId).run();

      return json({
        error: "MTN could not accept the payment request."
      }, 502);
    }

    return json({
      success: true,
      status: "PENDING",
      referenceId,
      amount: 5000,
      currency: "XAF",
      message: "Please approve the payment on your MTN phone."
    });

  } catch (error) {
    console.error("MTN payment request error:", error);

    return json({
      error: "Unable to start the MTN payment."
    }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    if (!checkConfiguration(env)) {
      return json({ error: "Payment system configuration is incomplete." }, 500);
    }

    const customer = await getCustomer(request, env);

    if (!customer) {
      return json({ error: "Please log in first." }, 401);
    }

    const url = new URL(request.url);
    const referenceId = url.searchParams.get("reference_id");

    if (!referenceId) {
      return json({ error: "Payment reference is required." }, 400);
    }

    const payment = await env.DB.prepare(`
      SELECT id, mtn_reference, status, provider_status, user_id
      FROM payment_requests
      WHERE mtn_reference = ?
        AND user_id = ?
      LIMIT 1
    `).bind(referenceId, customer.id).first();

    if (!payment) {
      return json({ error: "Payment not found." }, 404);
    }

    if (payment.provider_status === "SUCCESSFUL") {
      return json({
        success: true,
        status: "SUCCESSFUL",
        premium_active: true
      });
    }

    if (
      payment.provider_status === "FAILED" ||
      payment.provider_status === "REJECTED"
    ) {
      return json({
        success: true,
        status: payment.provider_status,
        premium_active: false
      });
    }

    const accessToken = await getMtnToken(env);

    const response = await fetch(
      "https://sandbox.momodeveloper.mtn.com/collection/v1_0/requesttopay/" +
      encodeURIComponent(referenceId),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "X-Target-Environment": "sandbox",
          "Ocp-Apim-Subscription-Key": env.MTN_SUBSCRIPTION_KEY
        }
      }
    );

    if (!response.ok) {
      return json({
        error: "Unable to check payment with MTN."
      }, 502);
    }

    const result = await response.json();
    const status = String(result.status || "").toUpperCase();

    if (status === "SUCCESSFUL") {
      const now = new Date().toISOString();

      await env.DB.batch([
        env.DB.prepare(`
          UPDATE payment_requests
          SET provider_status = 'SUCCESSFUL',
              status = 'approved',
              approved_at = ?,
              expires_at = datetime('now', '+30 days')
          WHERE id = ?
            AND provider_status != 'SUCCESSFUL'
        `).bind(now, payment.id),

        env.DB.prepare(`
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
        `).bind(customer.id)
      ]);

      return json({
        success: true,
        status: "SUCCESSFUL",
        premium_active: true
      });
    }

    if (status === "FAILED") {
      await env.DB.prepare(`
        UPDATE payment_requests
        SET provider_status = 'FAILED',
            status = 'rejected'
        WHERE id = ?
      `).bind(payment.id);
    } else {
      await env.DB.prepare(`
        UPDATE payment_requests
        SET provider_status = ?
        WHERE id = ?
      `).bind(status || "PENDING", payment.id);
    }

    return json({
      success: true,
      status: status || "PENDING",
      premium_active: false
    });

  } catch (error) {
    console.error("MTN payment verification error:", error);

    return json({
      error: "Unable to verify the MTN payment."
    }, 500);
  }
}

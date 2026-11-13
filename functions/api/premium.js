async function hashToken(token) {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token)
  );

  return Array.from(new Uint8Array(result))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function requirePremium(request, env) {
  try {
    if (!env.DB) {
      return {
        allowed: false,
        status: 500,
        error: "Database is unavailable."
      };
    }

    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7).trim()
      : "";

    if (!token || token.length > 200) {
      return {
        allowed: false,
        status: 401,
        error: "Please log in first."
      };
    }

    const tokenHash = await hashToken(token);
    const now = new Date().toISOString();

    const customer = await env.DB.prepare(`
      SELECT
        c.id,
        c.phone_number,
        c.premium_until
      FROM customer_sessions s
      JOIN customers c ON c.id = s.customer_id
      WHERE s.token_hash = ?
        AND s.expires_at > ?
      LIMIT 1
    `).bind(tokenHash, now).first();

    if (!customer) {
      return {
        allowed: false,
        status: 401,
        error: "Your session has expired. Please log in again."
      };
    }

    const premiumActive =
      customer.premium_until &&
      new Date(customer.premium_until).getTime() > Date.now();

    if (!premiumActive) {
      return {
        allowed: false,
        status: 403,
        error: "An active Premium subscription is required."
      };
    }

    return {
      allowed: true,
      customer
    };

  } catch (error) {
    console.error("Premium verification error:", error);

    return {
      allowed: false,
      status: 500,
      error: "Unable to verify your Premium subscription."
    };
  }
}

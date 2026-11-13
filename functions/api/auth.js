const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });

async function hashPassword(password, salt) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: 250000,
      hash: "SHA-256"
    },
    key,
    256
  );

  return Array.from(new Uint8Array(bits))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toHex(bytes) {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function digest(value) {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return toHex(new Uint8Array(result));
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({ error: "Database is unavailable." }, 500);
    }

    const body = await request.json();
    const action = String(body.action || "").toLowerCase();
    const phone = String(body.phone_number || "").trim();
    const password = String(body.password || "");

    if (!["register", "login", "logout"].includes(action)) {
      return json({ error: "Invalid action." }, 400);
    }

    if (action === "logout") {
      const token = request.headers
        .get("Authorization")
        ?.replace(/^Bearer /, "");

      if (token) {
        await env.DB.prepare(
          "DELETE FROM customer_sessions WHERE token_hash = ?"
        ).bind(await digest(token)).run();
      }

      return json({
        success: true,
        message: "Logged out."
      });
    }

    if (!phone || phone.length > 30) {
      return json({
        error: "Enter a valid phone number."
      }, 400);
    }

    if (password.length < 8 || password.length > 128) {
      return json({
        error: "Password must contain 8 to 128 characters."
      }, 400);
    }

    let customer;

    if (action === "register") {
      const salt = randomBytes(16);

      const passwordHash =
        toHex(salt) + ":" + await hashPassword(password, salt);

      try {
        await env.DB.prepare(`
          INSERT INTO customers (phone_number, password_hash)
          VALUES (?, ?)
        `).bind(phone, passwordHash).run();

      } catch (error) {
        console.error("Registration database error:", error);

        if (
          String(error.message || "")
            .toLowerCase()
            .includes("unique")
        ) {
          return json({
            error: "This phone number is already registered."
          }, 409);
        }

        throw error;
      }

      customer = await env.DB.prepare(`
        SELECT id, phone_number
        FROM customers
        WHERE phone_number = ?
      `).bind(phone).first();

      if (!customer) {
        throw new Error("Customer record could not be retrieved.");
      }

    } else {
      customer = await env.DB.prepare(`
        SELECT id, phone_number, password_hash
        FROM customers
        WHERE phone_number = ?
      `).bind(phone).first();

      if (!customer) {
        return json({
          error: "Incorrect phone number or password."
        }, 401);
      }

      const [saltHex, savedHash] =
        customer.password_hash.split(":");

      const salt = new Uint8Array(
        saltHex.match(/.{2}/g).map(byte => parseInt(byte, 16))
      );

      const suppliedHash = await hashPassword(password, salt);

      if (suppliedHash !== savedHash) {
        return json({
          error: "Incorrect phone number or password."
        }, 401);
      }
    }

    const token = toHex(randomBytes(32));
    const tokenHash = await digest(token);

    const expiresAt = new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    await env.DB.prepare(`
      INSERT INTO customer_sessions
      (customer_id, token_hash, expires_at)
      VALUES (?, ?, ?)
    `).bind(
      customer.id,
      tokenHash,
      expiresAt
    ).run();

    return json({
      success: true,
      message: action === "register"
        ? "Account created successfully."
        : "Login successful.",

      customer: {
        id: customer.id,
        phone_number: customer.phone_number
      },

      token,
      expires_at: expiresAt
    });

  } catch (error) {
    console.error("Authentication error:", error);

    return json({
      error: "Account request failed.",
      diagnostic: String(error?.message || error)
    }, 500);
  }
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) {
      return json({
        error: "Database is unavailable."
      }, 500);
    }

    const authorization =
      request.headers.get("Authorization") || "";

    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!token || token.length > 200) {
      return json({
        error: "Please log in first."
      }, 401);
    }

    const customer = await env.DB.prepare(`
      SELECT
        c.id,
        c.phone_number,
        c.premium_until
      FROM customer_sessions s
      JOIN customers c
        ON c.id = s.customer_id
      WHERE s.token_hash = ?
        AND s.expires_at > ?
      LIMIT 1
    `).bind(
      await digest(token),
      new Date().toISOString()
    ).first();

    if (!customer) {
      return json({
        error: "Session expired. Please log in again."
      }, 401);
    }

    const premiumActive = Boolean(
      customer.premium_until &&
      new Date(customer.premium_until).getTime() > Date.now()
    );

    return json({
      success: true,

      customer: {
        id: customer.id,
        phone_number: customer.phone_number
      },

      premium_active: premiumActive,
      premium_until: customer.premium_until || null
    });

  } catch (error) {
    console.error("Account check error:", error);

    return json({
      error: "Unable to check account."
    }, 500);
  }
}

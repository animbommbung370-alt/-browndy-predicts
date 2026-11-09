(() => {
  const API = "/api";
  const TOKEN_KEY = "browndy_customer_token";

  const getToken = () => sessionStorage.getItem(TOKEN_KEY);

  async function apiRequest(url, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (getToken()) {
      headers.Authorization = "Bearer " + getToken();
    }

    const response = await fetch(API + url, {
      ...options,
      headers,
      cache: "no-store"
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    return data;
  }

  const style = document.createElement("style");
  style.textContent = `
    #bp-account-button {
      position: fixed;
      right: 15px;
      bottom: 18px;
      z-index: 9998;
      border: 0;
      border-radius: 30px;
      padding: 13px 18px;
      background: #20b879;
      color: #061a12;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 5px 20px #0008;
    }
    #bp-account-overlay {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: #000b;
      padding: 18px;
      overflow-y: auto;
    }
    #bp-account-box {
      max-width: 430px;
      margin: 35px auto;
      padding: 22px;
      border-radius: 18px;
      background: #10281f;
      color: #fff;
      border: 1px solid #315b47;
      font-family: Arial, sans-serif;
    }
    #bp-account-box h2 { margin-top: 0; }
    #bp-account-box input {
      box-sizing: border-box;
      width: 100%;
      padding: 13px;
      margin: 7px 0 13px;
      border-radius: 9px;
      border: 1px solid #456b58;
      background: #071a14;
      color: white;
    }
    #bp-account-box button {
      padding: 12px 15px;
      margin: 5px 4px 5px 0;
      border: 0;
      border-radius: 9px;
      cursor: pointer;
      font-weight: bold;
    }
    .bp-main-button { background: #20b879; color: #061a12; }
    .bp-close-button { background: #294538; color: white; }
    #bp-account-message {
      margin: 12px 0;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .bp-account-section {
      border-top: 1px solid #315b47;
      padding-top: 15px;
      margin-top: 15px;
    }
  `;
  document.head.appendChild(style);

  const button = document.createElement("button");
  button.id = "bp-account-button";
  button.textContent = "My Account";
  document.body.appendChild(button);

  const overlay = document.createElement("div");
  overlay.id = "bp-account-overlay";
  overlay.innerHTML = `
    <div id="bp-account-box">
      <h2>Browndy Predicts Account</h2>
      <div id="bp-account-message">Create an account or log in.</div>

      <div id="bp-account-auth">
        <label>Phone number</label>
        <input id="bp-phone" type="tel" placeholder="Your phone number">

        <label>Password</label>
        <input id="bp-password" type="password"
          placeholder="At least 8 characters">

        <button class="bp-main-button" id="bp-register">Create account</button>
        <button class="bp-main-button" id="bp-login">Log in</button>
      </div>

      <div id="bp-account-logged" style="display:none">
        <p id="bp-account-details"></p>
        <p id="bp-premium-status"></p>

        <div class="bp-account-section">
          <h3>Activate Premium</h3>
          <p>Monthly subscription: <strong>5,000 FCFA</strong></p>
          <p>Send payment by MTN Mobile Money to:</p>
          <p><strong>680090335</strong><br>
          Recipient: <strong>Animbom Browndy Mbung</strong></p>

          <label>Name used for payment</label>
          <input id="bp-payment-name" placeholder="Your payment name">

          <label>MTN transaction ID</label>
          <input id="bp-transaction-id" placeholder="Transaction ID">

          <button class="bp-main-button" id="bp-submit-payment">
            Submit payment for verification
          </button>
        </div>

        <button class="bp-close-button" id="bp-logout">Log out</button>
      </div>

      <button class="bp-close-button" id="bp-close">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const message = text => {
    document.getElementById("bp-account-message").textContent = text;
  };

  async function refreshAccount() {
    const data = await apiRequest("/auth");

    document.getElementById("bp-account-auth").style.display = "none";
    document.getElementById("bp-account-logged").style.display = "block";

    document.getElementById("bp-account-details").textContent =
      "Logged in as: " + data.customer.phone_number;

    document.getElementById("bp-premium-status").textContent =
      data.premium_active
        ? "Premium is ACTIVE until " + data.premium_until
        : "Premium is not active yet. Submit payment details for verification.";

    message("Your account is ready.");
  }

  async function authenticate(action) {
    try {
      const phone = document.getElementById("bp-phone").value.trim();
      const password = document.getElementById("bp-password").value;

      message("Please wait...");

      const data = await apiRequest("/auth", {
        method: "POST",
        body: JSON.stringify({
          action,
          phone_number: phone,
          password
        })
      });

      sessionStorage.setItem(TOKEN_KEY, data.token);
      await refreshAccount();

    } catch (error) {
      message(error.message);
    }
  }

  button.addEventListener("click", async () => {
    overlay.style.display = "block";

    if (getToken()) {
      try {
        await refreshAccount();
      } catch (error) {
        sessionStorage.removeItem(TOKEN_KEY);
        document.getElementById("bp-account-auth").style.display = "block";
        document.getElementById("bp-account-logged").style.display = "none";
        message("Please log in again.");
      }
    } else {
      document.getElementById("bp-account-auth").style.display = "block";
      document.getElementById("bp-account-logged").style.display = "none";
      message("Create an account or log in.");
    }
  });

  document.getElementById("bp-register").onclick =
    () => authenticate("register");

  document.getElementById("bp-login").onclick =
    () => authenticate("login");

  document.getElementById("bp-submit-payment").onclick = async () => {
    try {
      const customerName =
        document.getElementById("bp-payment-name").value.trim();
      const transactionId =
        document.getElementById("bp-transaction-id").value.trim();

      if (!customerName || !transactionId) {
        message("Enter your payment name and transaction ID.");
        return;
      }

      message("Submitting payment details...");

      const data = await apiRequest("/payments", {
        method: "POST",
        body: JSON.stringify({
          customer_name: customerName,
          transaction_id: transactionId
        })
      });

      message(data.message || "Payment submitted for verification.");

    } catch (error) {
      message(error.message);
    }
  };

  document.getElementById("bp-logout").onclick = async () => {
    try {
      await apiRequest("/auth", {
        method: "POST",
        body: JSON.stringify({ action: "logout" })
      });
    } catch (error) {
      // Clear the local session even if the request fails.
    }

    sessionStorage.removeItem(TOKEN_KEY);
    document.getElementById("bp-account-auth").style.display = "block";
    document.getElementById("bp-account-logged").style.display = "none";
    message("You have logged out.");
  };

  document.getElementById("bp-close").onclick = () => {
    overlay.style.display = "none";
  };
})();

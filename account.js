(() => {
  const TOKEN_KEY = "browndy_customer_token";
  const API = "/api";

  function startAccount() {
    if (document.getElementById("bp-account-overlay")) return;

    const getToken = () => sessionStorage.getItem(TOKEN_KEY) || "";

    const style = document.createElement("style");

    style.textContent = `
      html.bp-account-locked,
      html.bp-account-locked body {
        overflow: hidden !important;
      }

      html.bp-account-locked header,
      html.bp-account-locked main,
      html.bp-account-locked footer {
        display: none !important;
      }

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
        display: flex;
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: #06150f;
        padding: 18px;
        overflow-y: auto;
        align-items: center;
        justify-content: center;
      }

      #bp-account-box {
        width: 100%;
        max-width: 430px;
        margin: auto;
        padding: 22px;
        border-radius: 18px;
        background: #10281f;
        color: #fff;
        border: 1px solid #315b47;
        font-family: Arial, sans-serif;
      }

      #bp-account-box h2 {
        margin-top: 0;
      }

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

      .bp-main-button {
        background: #20b879;
        color: #061a12;
      }

      .bp-close-button {
        background: #294538;
        color: white;
      }

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

      #bp-premium-status {
        color: #8df0ad;
        font-weight: bold;
      }

      #bp-account-box button:disabled {
        opacity: .5;
        cursor: wait;
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

        <div id="bp-account-message">
          Please create an account or log in.
        </div>

        <div id="bp-account-auth">
          <label>
            Phone number
            <input id="bp-phone" type="tel"
              placeholder="Your phone number">
          </label>

          <label>
            Password
            <input id="bp-password" type="password"
              placeholder="At least 8 characters">
          </label>

          <button class="bp-main-button" id="bp-register">
            Create account
          </button>

          <button class="bp-main-button" id="bp-login">
            Log in
          </button>
        </div>

        <div id="bp-account-logged" style="display:none">
          <p id="bp-account-details"></p>
          <p id="bp-premium-status"></p>

          <div class="bp-account-section" id="bp-payment-section">
            <h3>Activate Premium</h3>

            <p>Monthly subscription: <strong>5,000 FCFA</strong></p>

            <p>
              Pay 5,000 FCFA using MTN Mobile Money.
              Then enter your payment details below.
            </p>

            <label>
              Your full name
              <input id="bp-payment-name" type="text"
                placeholder="Enter your full name">
            </label>

            <label>
              MTN transaction ID
              <input id="bp-transaction-id" type="text"
                placeholder="Enter your transaction ID">
            </label>

            <button class="bp-main-button" id="bp-submit-payment">
              Submit Payment for Approval
            </button>

            <p>
              Your payment will be checked manually.
              Premium will activate after approval.
            </p>
          </div>

          <button class="bp-close-button" id="bp-logout">
            Log out
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const $ = id => document.getElementById(id);

    function message(text) {
      $("bp-account-message").textContent = text;
    }

    function lockAccount() {
      document.documentElement.classList.add("bp-account-locked");
      overlay.style.display = "flex";
      button.style.display = "none";
    }

    function unlockAccount() {
      document.documentElement.classList.remove("bp-account-locked");
      overlay.style.display = "none";
      button.style.display = "block";

      window.dispatchEvent(
        new CustomEvent("browndy:access-changed", {
          detail: { premiumActive: true }
        })
      );
    }

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

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Something went wrong.");
      }

      return data;
    }

    function showLogin(messageText = "Create an account or log in.") {
      $("bp-account-auth").style.display = "block";
      $("bp-account-logged").style.display = "none";
      message(messageText);
      lockAccount();
    }

    async function refreshAccount() {
      const data = await apiRequest("/auth");

      if (!data.customer) {
        throw new Error("Account information could not be loaded.");
      }

      $("bp-account-auth").style.display = "none";
      $("bp-account-logged").style.display = "block";

      $("bp-account-details").textContent =
        "Logged in as: " + data.customer.phone_number;

      const paymentSection = $("bp-payment-section");
      const premiumStatus = $("bp-premium-status");

      if (data.premium_active === true) {
        premiumStatus.textContent =
          "Premium ACTIVE until " + data.premium_until;

        paymentSection.style.display = "none";
        message("Your Premium subscription is active.");

        unlockAccount();
      } else {
        premiumStatus.textContent =
          "Premium is not active. Your account is locked.";

        paymentSection.style.display = "block";

        message(
          "Your account is registered, but you need an approved Premium subscription to enter the app."
        );

        lockAccount();
      }

      return data;
    }

    async function authenticate(action) {
      const authButton = action === "register"
        ? $("bp-register")
        : $("bp-login");

      try {
        const phone = $("bp-phone").value.trim();
        const password = $("bp-password").value;

        if (!phone || !password) {
          message("Enter your phone number and password.");
          return;
        }

        authButton.disabled = true;
        message("Please wait...");

        const data = await apiRequest("/auth", {
          method: "POST",
          body: JSON.stringify({
            action,
            phone_number: phone,
            password
          })
        });

        if (!data.token) {
          throw new Error("Login token was not received.");
        }

        sessionStorage.setItem(TOKEN_KEY, data.token);

        await refreshAccount();

      } catch (error) {
        message(error.message);
      } finally {
        authButton.disabled = false;
      }
    }

    async function submitPayment() {
      const payButton = $("bp-submit-payment");

      try {
        const customerName = $("bp-payment-name").value.trim();
        const transactionId = $("bp-transaction-id").value.trim();

        if (!customerName || !transactionId) {
          message("Enter your full name and MTN transaction ID.");
          return;
        }

        payButton.disabled = true;
        message("Submitting your payment details...");

        await apiRequest("/payments", {
          method: "POST",
          body: JSON.stringify({
            customer_name: customerName,
            transaction_id: transactionId
          })
        });

        $("bp-payment-name").value = "";
        $("bp-transaction-id").value = "";

        message(
          "Payment submitted successfully. Your payment is PENDING manual approval. Your account will unlock after approval."
        );

      } catch (error) {
        message(error.message);
      } finally {
        payButton.disabled = false;
      }
    }

    async function logout() {
      try {
        await apiRequest("/auth", {
          method: "POST",
          body: JSON.stringify({ action: "logout" })
        });
      } catch (error) {
        // The local session is cleared even if the request fails.
      }

      sessionStorage.removeItem(TOKEN_KEY);

      showLogin("You have logged out. Please log in again.");
    }

    button.addEventListener("click", async () => {
      lockAccount();

      if (!getToken()) {
        showLogin();
        return;
      }

      try {
        await refreshAccount();
      } catch (error) {
        sessionStorage.removeItem(TOKEN_KEY);
        showLogin("Your session has expired. Please log in again.");
      }
    });

    $("bp-register").addEventListener("click", () => {
      authenticate("register");
    });

    $("bp-login").addEventListener("click", () => {
      authenticate("login");
    });

    $("bp-submit-payment").addEventListener("click", submitPayment);

    $("bp-logout").addEventListener("click", logout);

    // Keep the account screen locked while checking access.
    lockAccount();

    // Check the customer's existing subscription on page opening.
    async function checkExistingSession() {
      if (!getToken()) {
        showLogin();
        return;
      }

      try {
        message("Checking your account and subscription...");
        await refreshAccount();
      } catch (error) {
        sessionStorage.removeItem(TOKEN_KEY);
        showLogin("Please log in again.");
      }
    }

    checkExistingSession();

    // Recheck the subscription when the customer returns to the app.
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible") return;
      if (!getToken()) return;

      try {
        await refreshAccount();
      } catch (error) {
        sessionStorage.removeItem(TOKEN_KEY);
        showLogin("Your session has expired. Please log in again.");
      }
    });
  }

  // Hide the main app immediately, before the account check runs.
  document.documentElement.classList.add("bp-account-locked");

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startAccount);
  } else {
    startAccount();
  }
})();

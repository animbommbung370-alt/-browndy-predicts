(() => {
const API = “/api”;
const TOKEN_KEY = “browndy_customer_token”;

let paymentCheckTimer = null;

const getToken = () => sessionStorage.getItem(TOKEN_KEY);

async function apiRequest(url, options = {}) {
const headers = {
“Content-Type”: “application/json”,
…(options.headers || {})
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

const style = document.createElement(“style”);

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

`;

document.head.appendChild(style);

const button = document.createElement(“button”);
button.id = “bp-account-button”;
button.textContent = “My Account”;
document.body.appendChild(button);

const overlay = document.createElement(“div”);
overlay.id = “bp-account-overlay”;

overlay.innerHTML = `
  <h2>Browndy Predicts Account</h2>
  <div id="bp-account-message">
    Create an account or log in.
  </div>
  <div id="bp-account-auth">
    <label>Phone number</label>
    <input id="bp-phone" type="tel" placeholder="Your phone number">
    <label>Password</label>
    <input id="bp-password" type="password"
      placeholder="At least 8 characters">
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
      <p>Pay securely using MTN Mobile Money.</p>
      <label>MTN Mobile Money number</label>
      <input id="bp-mtn-phone" type="tel"
        placeholder="Example: 670000000">
      <button class="bp-main-button" id="bp-submit-payment">
        Pay 5,000 FCFA
      </button>
      <p>
        You will receive a payment request on your MTN phone.
        Approve it only if the amount is 5,000 FCFA.
      </p>
    </div>
    <button class="bp-close-button" id="bp-logout">
      Log out
    </button>
  </div>
  <button class="bp-close-button" id="bp-close">
    Close
  </button>
</div>

`;

document.body.appendChild(overlay);

const message = text => {
document.getElementById(“bp-account-message”).textContent = text;
};

async function refreshAccount() {
const data = await apiRequest(”/auth”);

document.getElementById("bp-account-auth").style.display = "none";
document.getElementById("bp-account-logged").style.display = "block";
document.getElementById("bp-account-details").textContent =
  "Logged in as: " + data.customer.phone_number;
const paymentSection =
  document.getElementById("bp-payment-section");
const premiumStatus =
  document.getElementById("bp-premium-status");
if (data.premium_active === true) {
  premiumStatus.textContent =
    "✅ Premium ACTIVE until " + data.premium_until;
  paymentSection.style.display = "none";
} else {
  premiumStatus.textContent =
    "Premium is not active.";
  paymentSection.style.display = "block";
}
message("Your account is ready.");
return data;

}

function openPredictions() {
clearInterval(paymentCheckTimer);
overlay.style.display = “none”;
window.location.reload();
}

function checkPaymentStatus(referenceId) {
clearInterval(paymentCheckTimer);

let attempts = 0;
message(
  "Payment request sent. Please check your MTN phone and approve the request."
);
paymentCheckTimer = setInterval(async () => {
  attempts++;
  try {
    const data = await apiRequest(
      "/mtn-payment?reference_id=" +
      encodeURIComponent(referenceId)
    );
    if (data.status === "SUCCESSFUL") {
      clearInterval(paymentCheckTimer);
      const account = await refreshAccount();
      if (account.premium_active === true) {
        message(
          "🎉 Payment confirmed! Your Premium subscription is active."
        );
        setTimeout(openPredictions, 2000);
      } else {
        message(
          "Payment confirmed. Please refresh your account to check Premium status."
        );
      }
      return;
    }
    if (
      data.status === "FAILED" ||
      data.status === "REJECTED"
    ) {
      clearInterval(paymentCheckTimer);
      message(
        "Payment was not completed. Please try again."
      );
      return;
    }
    message(
      "Waiting for MTN payment confirmation... Please approve the request on your phone."
    );
  } catch (error) {
    console.log("Payment status check:", error.message);
  }
  if (attempts >= 36) {
    clearInterval(paymentCheckTimer);
    message(
      "We are still waiting for MTN. Open your account later and try again to check the payment."
    );
  }
}, 5000);

}

async function authenticate(action) {
try {
const phone =
document.getElementById(“bp-phone”).value.trim();

  const password =
    document.getElementById("bp-password").value;
  if (!phone || !password) {
    message("Enter your phone number and password.");
    return;
  }
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
  const account = await refreshAccount();
  if (account.premium_active === true) {
    message("Premium active! Opening predictions...");
    setTimeout(openPredictions, 1000);
  }
} catch (error) {
  message(error.message);
}

}

button.addEventListener(“click”, async () => {
overlay.style.display = “block”;

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

document.getElementById(“bp-register”).onclick =
() => authenticate(“register”);

document.getElementById(“bp-login”).onclick =
() => authenticate(“login”);

document.getElementById(“bp-submit-payment”).onclick = async () => {
const payButton =
document.getElementById(“bp-submit-payment”);

try {
  const phoneNumber =
    document.getElementById("bp-mtn-phone").value.trim();
  if (!phoneNumber) {
    message("Enter your MTN Mobile Money number.");
    return;
  }
  payButton.disabled = true;
  message("Connecting to MTN... Please wait.");
  const data = await apiRequest("/mtn-payment", {
    method: "POST",
    body: JSON.stringify({
      phoneNumber
    })
  });
  if (!data.success || !data.referenceId) {
    throw new Error("MTN payment request could not be started.");
  }
  message(
    "Payment request sent. Approve 5,000 FCFA on your MTN phone."
  );
  checkPaymentStatus(data.referenceId);
} catch (error) {
  message(error.message);
} finally {
  payButton.disabled = false;
}

};

document.getElementById(“bp-logout”).onclick = async () => {
clearInterval(paymentCheckTimer);

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

document.getElementById(“bp-close”).onclick = () => {
overlay.style.display = “none”;
};

})();

export async function onRequestPost({ request, env }) {
  try {
    const {
      phoneNumber
    } = await request.json();

    if (!phoneNumber) {
      return Response.json(
        { error: "Please enter your MTN phone number." },
        { status: 400 }
      );
    }

    // Check that the Cameroon MTN number is valid
    const phone = String(phoneNumber).replace(/\D/g, "");
    const msisdn = phone.startsWith("237")
      ? phone
      : `237${phone}`;

    if (!/^2376\d{8}$/.test(msisdn)) {
      return Response.json(
        { error: "Enter a valid Cameroon MTN number." },
        { status: 400 }
      );
    }

    // Check that all private MTN credentials exist
    const {
      MTN_SUBSCRIPTION_KEY,
      MTN_API_USER_ID,
      MTN_API_KEY
    } = env;

    if (
      !MTN_SUBSCRIPTION_KEY ||
      !MTN_API_USER_ID ||
      !MTN_API_KEY
    ) {
      return Response.json(
        { error: "MTN payment credentials are not configured." },
        { status: 500 }
      );
    }

    const baseUrl =
      "https://sandbox.momodeveloper.mtn.com";

    // Generate MTN authentication
    const credentials = btoa(
      `${MTN_API_USER_ID}:${MTN_API_KEY}`
    );

    // Request an access token
    const tokenResponse = await fetch(
      `${baseUrl}/collection/token/`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Ocp-Apim-Subscription-Key":
            MTN_SUBSCRIPTION_KEY,
          "X-Target-Environment": "sandbox"
        }
      }
    );

    if (!tokenResponse.ok) {
      return Response.json(
        { error: "MTN authentication failed." },
        { status: 502 }
      );
    }

    const tokenData = await tokenResponse.json();

    // Create a unique payment reference
    const referenceId = crypto.randomUUID();

    // Request the monthly subscription payment
    const paymentResponse = await fetch(
      `${baseUrl}/collection/v1_0/requesttopay`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tokenData.access_token}`,
          "X-Reference-Id": referenceId,
          "X-Target-Environment": "sandbox",
          "Ocp-Apim-Subscription-Key":
            MTN_SUBSCRIPTION_KEY,
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
          payerMessage: "Browndy Predicts subscription",
          payeeNote: "Monthly Premium subscription"
        })
      }
    );

    if (paymentResponse.status !== 202) {
      return Response.json(
        { error: "MTN could not process the payment request." },
        { status: 502 }
      );
    }

    return Response.json({
      success: true,
      status: "PENDING",
      message: "Please approve the payment on your MTN MoMo phone.",
      referenceId,
      amount: 5000,
      currency: "XAF"
    });

  } catch (error) {
    return Response.json(
      { error: "Something went wrong with the MTN payment request." },
      { status: 500 }
    );
  }
}

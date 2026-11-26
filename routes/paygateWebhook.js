/* ==========================================================================
   PayGate webhook — the only place a PayGate payment becomes an approved
   subscription automatically. PayGate marks a payment "success" only after it
   has matched a real bKash / Nagad SMS to it, and every delivery here is
   HMAC-verified against the app's whsec_ secret.
   Mounted before tenant resolution: this request carries no shop host.
   ========================================================================== */
const express = require("express");
const router = express.Router();
const paygate = require("../lib/paygate");
const settlement = require("../lib/paygateSettlement");

router.post("/paygate", async (req, res) => {
  // The HMAC covers the exact bytes PayGate signed, so rawBody is required —
  // express.json already stored it in server.js.
  const raw = req.rawBody ? req.rawBody.toString("utf8") : "";
  try {
    const config = await paygate.getConfig();
    if (!config.configured) return res.status(503).json({ error: "paygate_not_configured" });

    const signature = req.get("x-paygate-signature") || "";
    const timestamp = req.get("x-paygate-timestamp") || "";
    if (!paygate.verifyWebhook({ rawBody: raw, signature, timestamp, secret: config.webhookSecret })) {
      console.error("PayGate webhook rejected: bad signature or stale timestamp");
      return res.status(401).json({ error: "invalid_signature" });
    }

    const event = paygate.parseEvent(raw);
    const payment = event && event.data;
    if (!event || !payment || !payment.id) return res.status(400).json({ error: "invalid_event" });

    const platformPaymentId = (payment.metadata || {}).platformPaymentId;
    // Another integration shares this PayGate app — not ours to settle.
    if (!platformPaymentId) return res.json({ received: true, ignored: true });

    if (event.type === "payment.succeeded") {
      await settlement.settlePayment({ platformPaymentId, paygatePayment: payment, eventId: event.id });
    } else if (event.type === "payment.expired") {
      await settlement.rejectUnpaidPayment({ platformPaymentId, paygatePayment: payment });
    }
    // Unknown event types are acknowledged so PayGate stops retrying them.

    res.json({ received: true });
  } catch (err) {
    // A duplicate delivery races with the first one — that is a success.
    if (err && (err.status === 409 || err.code === 11000)) return res.json({ received: true, duplicate: true });
    // Row gone / wrong gateway / amount off: retrying cannot help, so ack it
    // and leave enough in the log for a human to trace the payment.
    if (err && (err.status === 404 || err.status === 400)) {
      const event = paygate.parseEvent(raw);
      console.error(
        "PayGate webhook ignored:",
        err.message,
        JSON.stringify({ event: event && event.id, payment: event && event.data && event.data.id, amount: event && event.data && event.data.amount })
      );
      return res.json({ received: true, ignored: true });
    }
    console.error("PayGate webhook error:", err.message);
    // 5xx makes PayGate retry from its outbox.
    res.status(500).json({ error: "webhook_processing_failed" });
  }
});

module.exports = router;

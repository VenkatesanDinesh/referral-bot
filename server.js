require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// 🔹 Webhook verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// 🔹 Receive messages
app.post("/webhook", async (req, res) => {
  const body = req.body;

  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (message) {
    const from = message.from;
    const text = message.text?.body;

    console.log("Incoming:", from, text);

    let reply = "";

    if (!text) {
      reply = "Please send a valid message.";
    } 
    else if (text.toLowerCase().includes("hi")) {
      reply = "Welcome to Donto Referral Service 👨‍⚕️\n\n1️⃣ Raise New Case\n2️⃣ Check Status";
    } 
    else if (text === "1") {
      reply = "Please enter:\n• Patient Age\n• Problem Type\n• Urgency\n• Location";
    } 
    else {
      reply = "I didn't understand. Please type 1 or 2.";
    }

    await axios.post(
      `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: reply },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
  }

  res.sendStatus(200);
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
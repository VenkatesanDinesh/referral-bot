require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = "venky_bot_token";
const ACCESS_TOKEN = "EAAtZA1FmKgpcBQZC0ZBYVSCeHpOVHXttdZBoIxFXxdU9mKdKM9YZCP2IKuUvtOVWAXpIzS4RbuYVJUWazZAF41ZCYICbSLzBnhqZB3ZBqXCXk2aZCOmArOsTzQIZCfXove5Gr6ZB18ufz4quAz9xV4JZBt4VU1qRZCFuRViLM8SJJePP8noJgywVTtxQHWeN3btNMZAe6cZBijE4lcqAjfYljTWoiYbUyhSAYHvGF3wBbfrGdzpXgzUmGQ5rvIbj6jVZCfex2FneM4rmCNT3eTciv5yjvTNVpupek";
const PHONE_NUMBER_ID = "977597622109820";

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

  const message =
    body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (message) {
    const from = message.from;
    const text = message.text?.body;

    console.log("Incoming:", from, text);

    // 🔥 Reply back
    await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: from,
        text: { body: "Hello from Donto Bot 👨‍⚕️" },
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
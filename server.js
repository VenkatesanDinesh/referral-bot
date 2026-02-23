require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { google } = require("googleapis");
const { v4: uuidv4 } = require("uuid");

// 🔐 Google Auth (Render Safe)
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// 📄 Sheet ID from Render env
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const app = express();
app.use(express.json());

const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

const sessions = {};

// -----------------------------
// DATA
// -----------------------------

const specialistOptions = [
  "Prosthodontist",
  "Endodontist",
  "Restorative Dentist",
  "Pedodontist",
  "Periodontist",
  "Oral Surgery",
  "Implantologist"
];

const procedurePlanOptions = {
  Prosthodontist: [
    "Tooth Preparation",
    "Inlay/Onlay",
    "Veneers",
    "Complete Dentures"
  ],
  Endodontist: [
    "Consultation",
    "Anterior RCT",
    "Posterior RCT",
    "Re-RCT"
  ],
  Implantologist: [
    "Implant Placement",
    "Sinus Lift",
    "All on 4 Surgery"
  ]
};

// -----------------------------
// WEBHOOK VERIFY
// -----------------------------

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
// -----------------------------
// SAVE TO GOOGLE SHEET
// -----------------------------

async function saveToGoogleSheet(data) {
  const primaryKey = uuidv4();

  const values = [[
    primaryKey,
    new Date().toISOString(),
    data.clinicPhone,
    data.appointment,
    data.isPrivate ? "Yes" : "No",
    data.specialists.join(", "),
    data.procedures.join(", "),
    data.patientName,
    data.medical,
    "", // Doctor Name (future)
    "", // Doctor Phone (future)
    "NEW"
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  return primaryKey;
}
// -----------------------------
// MAIN FLOW
// -----------------------------

app.post("/webhook", async (req, res) => {
  const body = req.body;
  const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (!message) return res.sendStatus(200);

  const from = message.from;
  const text = message.text?.body?.trim();

// -----------------------------
// GLOBAL CANCEL / STOP
// -----------------------------
if (text?.toLowerCase() === "cancel") {
  delete sessions[from];

  await axios.post(
    `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: from,
      text: { body: "❌ Session cancelled. Type HI to start again." },
    },
    {
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );

  return res.sendStatus(200);
}
  if (!sessions[from]) {
    sessions[from] = { step: "start", data: {} };
  }

  const user = sessions[from];
  let reply = "";

  switch (user.step) {

    // ---------------- START ----------------
    case "start":
      reply =
        "👨‍⚕️ *Donto Referral System*\n\n" +
        "1️⃣ Open New Request\n" +
        "2️⃣ Cancel\n\n" +
        "Reply with number.";
      user.step = "main_menu";
      break;

    case "main_menu":
      if (text === "1") {
        reply = "📅 Enter Appointment Date & Time (YYYY-MM-DD HH:MM)";
        user.step = "appointment";
      } else {
        reply = "Session closed.";
        delete sessions[from];
      }
      break;

    // ---------------- APPOINTMENT ----------------
    case "appointment":
      user.data.appointment = text;
      reply = "🔐 Private Request?\n1️⃣ Yes\n2️⃣ No";
      user.step = "private";
      break;

    case "private":
      user.data.isPrivate = text === "1";
      reply = "Select Specialist(s)\n(You can send multiple numbers separated by comma)\n\n";

      specialistOptions.forEach((s, i) => {
        reply += `${i + 1}️⃣ ${s}\n`;
      });

      reply += "\nExample: 1 or 1,3,5";
      user.step = "specialist";
      break;

    // ---------------- SPECIALIST ----------------
    case "specialist":
      const selections = text.split(",").map(n => parseInt(n.trim()));
      const chosenSpecialists = selections
        .filter(n => n >= 1 && n <= specialistOptions.length)
        .map(n => specialistOptions[n - 1]);

      if (!chosenSpecialists.length) {
        reply = "❌ Invalid selection. Please enter valid number(s).";
        break;
      }

      user.data.specialists = chosenSpecialists;

      // Show procedures based on selected specialists
      let procedureList = [];
      chosenSpecialists.forEach(s => {
        if (procedurePlanOptions[s]) {
          procedureList = [...procedureList, ...procedurePlanOptions[s]];
        }
      });

      user.data.availableProcedures = procedureList;

      reply = "Select Procedure(s):\n";
      procedureList.forEach((p, i) => {
        reply += `${i + 1}️⃣ ${p}\n`;
      });

      reply += "\nReply with number(s). Example: 1 or 1,2";
      user.step = "procedure";
      break;

    // ---------------- PROCEDURE ----------------
    case "procedure":
      const procSelections = text.split(",").map(n => parseInt(n.trim()));
      const chosenProcedures = procSelections
        .filter(n => n >= 1 && n <= user.data.availableProcedures.length)
        .map(n => user.data.availableProcedures[n - 1]);

      if (!chosenProcedures.length) {
        reply = "❌ Invalid procedure selection.";
        break;
      }

      user.data.procedures = chosenProcedures;
      reply = "👤 Enter Patient Name:";
      user.step = "patient";
      break;

    // ---------------- PATIENT ----------------
    case "patient":
      user.data.patientName = text;
      reply = "🩺 Enter Medical History (or type 0 for None)";
      user.step = "medical";
      break;

    case "medical":
      user.data.medical = text === "0" ? "None" : text;

      reply =
        "📜 *Terms & Conditions*\n\n" +
        "1️⃣ The clinic confirms patient consent.\n" +
        "2️⃣ Specialist assignment is subject to availability.\n" +
        "3️⃣ Cancellation must be informed 24 hours prior.\n" +
        "4️⃣ Donto is not liable for inter-clinic disputes.\n\n" +
        "1️⃣ Accept & Submit\n" +
        "2️⃣ Cancel\n\n" +
        "Reply with number.";

      user.step = "terms";
      break;

    // ---------------- TERMS ----------------
    case "terms":
      if (text === "1") {
         const requestId = await saveToGoogleSheet({
      clinicPhone: from,
      appointment: user.data.appointment,
      isPrivate: user.data.isPrivate,
      specialists: user.data.specialists,
      procedures: user.data.procedures,
      patientName: user.data.patientName,
      medical: user.data.medical
    });
        reply =
          "✅ Request Submitted Successfully!\n\n" +
          "Summary:\n" +
          `📅 ${user.data.appointment}\n` +
          `👨‍⚕️ ${user.data.specialists.join(", ")}\n` +
          `🦷 ${user.data.procedures.join(", ")}\n` +
          `👤 ${user.data.patientName}\n\n` +
          "Thank you!";
        delete sessions[from];
      } else {
        reply = "❌ Request Cancelled.";
        delete sessions[from];
      }
      break;

    default:
      reply = "Type HI to start.";
      delete sessions[from];
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

  res.sendStatus(200);
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});
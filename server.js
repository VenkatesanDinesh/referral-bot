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
    "Inlay/ Onlay / overlay-Endo Crown",
    "Veneers",
    "Crown removal",
    "Provisional/ Temporary Crown",
    "Complete dentures",
    "Tooth/Implant supported overdenture",
    "Flexi Dentures",
    "Cast partials",
    "Post & Core",
    "Precision attachment unilateral",
    "Precision attachment bilateral",
    "Implant rehabilitation- (single/multiple)",
    "Maxillofacial prosthesis",
  ],
  Endodontist: [
    "Consult.",
    "Ant. RCT.",
    "Post. RCT",
    "ReRCT",
    "Instrument Retrieval",
    "Fiber Post/Cast Post",
    "Bonded Pestoration",
  ],
  "Restorative Dentist": [
    "Consult.",
    "Composite smile Makeover.",
    "Veneers Smile Makeover",
    "Diastema Closure Comp/Ceramic",
    "Class 2 Restoration",
    "Deep Carries Management",
    "Fluoride Application",
    "Class 3/4 Restoration",
    "E-max Bonded restoration",
    "Anterior composite",
    "Vital bleaching",
    "Non vital bleaching"
  ],
  Pedodontist: [
    "Pulpotomy/Pulpectomy.",
    "SSC.",
    "Zirconia crown",
    "Extraction",
    "Habit breaking appliance",
    "Strip crowns",
  ],
  Periodontist: [
    "Sinus lift direct/indirect.",
    "Implant site development.",
    "Soft/hard tissue grafting",
    "Flap surgery",
    "Frenectomy laser/scapel",
    "Recession coverage",
    "Gingival depigmentation",
  ],
  "Oral Surgery": [
    "Disimpaction surgery.",
    "Extraction.",
    "Biopsy",
    "Major cyst nucleation",
    "Implants: conventional/ Basal/ pterygoid implants",
  ],
  Implantologist: [
    "Implant placement and restoration",
    "Sinus lift direct/indirect",
    "Soft tissue grafting",
    "Hard tissue grafting",
    "All on 4 surgery",
    "All on 4 prosthesis",
    "Zygoma implants",
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

async function getAvailableDoctor(specialist) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "DoctorDetails!A2:F100",
  });

  const rows = response.data.values;
  if (!rows) return null;

  const filtered = rows
    .filter(r => r[3] === specialist && r[4] === "Yes")
    .sort((a, b) => parseInt(a[5] || 0) - parseInt(b[5] || 0));

  if (filtered.length === 0) return null;

  return {
    doctorId: filtered[0][0],
    doctorName: filtered[0][1],
    doctorPhone: filtered[0][2],
    rowIndex: rows.indexOf(filtered[0]) + 2
  };
}
async function sendDoctorMessage(doctor, data, requestId) {
  const message =
    "🆕 *New Case Assigned*\n\n" +
    `Request ID: ${requestId}\n` +
    `Patient: ${data.patientName}\n` +
    `Date: ${data.appointment}\n\n` +
    "Reply:\n1️⃣ Accept\n2️⃣ Decline";

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: doctor.doctorPhone,
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        }
      }
    );

    console.log("Doctor message sent:", response.data);

  } catch (error) {
    console.log("❌ WhatsApp Error:");
    console.log(error.response?.data || error.message);
  }
}
async function handleDoctorResponse(phone, response) {

  const sheet = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A2:K100",
  });

  const rows = sheet.data.values;
  if (!rows) return false;

  for (let i = 0; i < rows.length; i++) {

    const doctorPhone = rows[i][9];
    const status = rows[i][10];

    if (doctorPhone === phone && status === "ASSIGNED") {

      const newStatus = response === "1" ? "ACCEPTED" : "DECLINED";

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Sheet1!K${i + 2}`,
        valueInputOption: "RAW",
        requestBody: { values: [[newStatus]] },
      });

      // Optional: Notify doctor
      await axios.post(
        `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: phone,
          text: { body: `✅ Case ${newStatus}` }
        },
        {
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          }
        }
      );

      return true; // important
    }
  }

  return false; // not a doctor case
}
// -----------------------------
// SAVE TO GOOGLE SHEET
// -----------------------------
async function saveToGoogleSheet(data) {
  const primaryKey = uuidv4();

  // 🔹 Get doctor based on first specialist
  const assignedDoctor = await getAvailableDoctor(data.specialists[0]);

  let doctorName = "";
  let doctorPhone = "";
  let status = "PENDING";

  if (assignedDoctor) {
    doctorName = assignedDoctor.doctorName;
    doctorPhone = assignedDoctor.doctorPhone;
    status = "ASSIGNED";
  }

  const values = [[
    primaryKey,
    data.appointment,
    data.clinicPhone,
    data.isPrivate ? "Yes" : "No",
    data.specialists.join(", "),
    data.procedures.join(", "),
    data.patientName,
    data.medical,
    doctorName,
    doctorPhone,
    status
  ]];

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "Sheet1!A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });

  // 🔹 Send WhatsApp to doctor
  if (assignedDoctor) {
    await sendDoctorMessage(assignedDoctor, data, primaryKey);
  }

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
// ------------------------------------
// Doctor Accept / Decline Handling
// ------------------------------------
if (text === "1" || text === "2") {

  const handled = await handleDoctorResponse(from, text);

  if (handled) {
    return res.sendStatus(200); // stop clinic flow
  }
}
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
    reply =
      "📅 Select Appointment Date:\n\n" +
      "1️⃣ Today\n" +
      "2️⃣ Tomorrow\n" +
      "3️⃣ Day After Tomorrow\n\n" +
      "Reply with number.";
    user.step = "appointment_date";
  } else {
    reply = "Session closed.";
    delete sessions[from];
  }
  break;

    // ---------------- APPOINTMENT ----------------
    case "appointment_date":
  const today = new Date();
  let selectedDate;

  if (text === "1") {
    selectedDate = today;
  } else if (text === "2") {
    selectedDate = new Date();
    selectedDate.setDate(today.getDate() + 1);
  } else if (text === "3") {
    selectedDate = new Date();
    selectedDate.setDate(today.getDate() + 2);
  } else {
    reply = "❌ Invalid option. Please select 1, 2, or 3.";
    break;
  }

  user.data.date = selectedDate.toISOString().split("T")[0];

  reply =
    "⏰ Select Time Slot:\n\n" +
    "1️⃣ 09:00 AM\n" +
    "2️⃣ 11:00 AM\n" +
    "3️⃣ 02:00 PM\n" +
    "4️⃣ 04:00 PM\n\n" +
    "Reply with number.";

  user.step = "appointment_time";
  break;
  case "appointment_time":
  let selectedTime = "";

  if (text === "1") selectedTime = "09:00";
  else if (text === "2") selectedTime = "11:00";
  else if (text === "3") selectedTime = "14:00";
  else if (text === "4") selectedTime = "16:00";
  else {
    reply = "❌ Invalid option. Please select 1-4.";
    break;
  }

  user.data.appointment = `${user.data.date} ${selectedTime}`;

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
const express = require("express");
const { google } = require("googleapis");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
const calendar = google.calendar({ version: "v3", auth: oauth2Client });

const CLINIC_CONFIG = {
  calendarId: process.env.GOOGLE_CALENDAR_ID || "primary",
  timezone: "Asia/Kolkata",
  appointmentDurationMins: 30,
  workingHours: {
    0: { open: "11:00", close: "14:00" },
    1: { open: "10:00", close: "20:00" },
    2: { open: "10:00", close: "20:00" },
    3: { open: "10:00", close: "20:00" },
    4: { open: "10:00", close: "20:00" },
    5: { open: "10:00", close: "20:00" },
    6: { open: "10:00", close: "20:00" },
  },
  timeSlots: {
    morning:   ["10:00","10:30","11:00","11:30","12:00","12:30"],
    afternoon: ["13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30"],
    evening:   ["17:00","17:30","18:00","18:30","19:00","19:30"],
  },
};

function buildDateTime(dateStr, timeStr) {
  return `${dateStr}T${timeStr}:00+05:30`;
}

async function getBookedSlots(dateStr) {
  const res = await calendar.events.list({
    calendarId: CLINIC_CONFIG.calendarId,
    timeMin: `${dateStr}T00:00:00+05:30`,
    timeMax: `${dateStr}T23:59:59+05:30`,
    singleEvents: true,
    orderBy: "startTime",
  });
  return (res.data.items || []).map((event) => {
    const start = new Date(event.start.dateTime || event.start.date);
    const hh = String(start.getUTCHours() + 5).padStart(2, "0");
    const mm = String(start.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  });
}

function generateRef() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

app.get("/", (req, res) => {
  res.json({ status: "ok", clinic: "Dynamic Dental Clinic", uptime: process.uptime() });
});

app.post("/api/check-availability", async (req, res) => {
  const { date, timePreference } = req.body;
  if (!date || !timePreference) return res.status(400).json({ error: "date and timePreference are required" });
  try {
    const dayOfWeek = new Date(date).getDay();
    if (!CLINIC_CONFIG.workingHours[dayOfWeek]) return res.json({ available: false, message: "The clinic is closed on that day.", slots: [] });
    const allSlots = CLINIC_CONFIG.timeSlots[timePreference] || [];
    const bookedSlots = await getBookedSlots(date);
    const freeSlots = allSlots.filter((slot) => !bookedSlots.includes(slot));
    if (freeSlots.length === 0) return res.json({ available: false, message: `No ${timePreference} slots on ${date}.`, slots: [] });
    return res.json({ available: true, slots: freeSlots, suggestedTime: freeSlots[0] });
  } catch (err) {
    return res.status(500).json({ error: "Failed to check availability." });
  }
});

app.post("/api/book-appointment", async (req, res) => {
  const { patientName, phoneNumber, date, time, reason, isEmergency } = req.body;
  if (!patientName || !phoneNumber || !date || !time || !reason) return res.status(400).json({ error: "Missing required fields." });
  try {
    const [hh, mm] = time.split(":").map(Number);
    const endMins = mm + CLINIC_CONFIG.appointmentDurationMins;
    const endTime = `${String(hh + Math.floor(endMins/60)).padStart(2,"0")}:${String(endMins%60).padStart(2,"0")}`;
    const bookingRef = generateRef();
    const event = {
      summary: `${isEmergency ? "🚨 EMERGENCY – " : ""}${reason} – ${patientName}`,
      description: `Patient: ${patientName}\nPhone: ${phoneNumber}\nTreatment: ${reason}\nRef: ${bookingRef}\nBooked via: Vapi AI`,
      start: { dateTime: buildDateTime(date, time), timeZone: CLINIC_CONFIG.timezone },
      end: { dateTime: buildDateTime(date, endTime), timeZone: CLINIC_CONFIG.timezone },
      colorId: isEmergency ? "11" : "2",
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
    };
    await calendar.events.insert({ calendarId: CLINIC_CONFIG.calendarId, resource: event });
    const dateObj = new Date(`${date}T12:00:00+05:30`);
    const friendlyDate = dateObj.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" });
    const hour = hh > 12 ? hh - 12 : hh === 0 ? 12 : hh;
    const friendlyTime = `${hour}:${String(mm).padStart(2,"0")} ${hh >= 12 ? "PM" : "AM"}`;
    return res.json({ success: true, bookingReference: bookingRef, confirmationMessage: `Confirmed! See you on ${friendlyDate} at ${friendlyTime}. Ref: ${bookingRef}.` });
  } catch (err) {
    return res.status(500).json({ error: "Failed to book appointment." });
  }
});

app.post("/api/vapi-webhook", (req, res) => {
  res.status(200).json({ received: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🦷 Dental Vapi Backend running on port ${PORT}`));

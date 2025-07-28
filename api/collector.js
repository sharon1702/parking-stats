import admin from 'firebase-admin';
import axios from 'axios';
import { JSDOM } from 'jsdom';

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

const parkingLots = [
  { id: 122, name: "חניון אסותא" },
  { id: 3, name: "חניון בזל" },
];

export default async function handler(request, response) {
  // --- NEW: Security Check ---
  // Check for the secret key in the query parameters
  if (request.query.secret !== process.env.CRON_SECRET) {
    return response.status(401).send('Unauthorized');
  }

  console.log("Running parking stats collection via Vercel trigger.");
  const fetchPromises = parkingLots.map(lot => fetchSingleParkingStatus(lot));

  try {
    await Promise.all(fetchPromises);
    console.log("Job finished successfully.");
    response.status(200).send("Successfully collected stats.");
  } catch (error) {
    console.error("Job failed:", error);
    response.status(500).send("An error occurred during collection.");
  }
}

async function fetchSingleParkingStatus(lot) {
  const targetUrl = `https://www.ahuzot.co.il/Parking/ParkingDetails/?ID=${lot.id}`;
  try {
    const res = await axios.get(targetUrl, { timeout: 20000 });
    const htmlText = res.data;
    if (!htmlText) {
      console.error(`Empty response for lot ${lot.id}`); return;
    }
    const dom = new JSDOM(htmlText);
    const doc = dom.window.document;
    const statusImage = doc.querySelector('.ParkingDetailsTable img[src*="/pics/ParkingIcons/"]');
    let statusText = "סטטוס לא ידוע";
    if (statusImage) {
      const imgSrcLower = statusImage.getAttribute("src").toLowerCase();
      if (imgSrcLower.includes("male.png")) statusText = "החניון מלא";
      else if (imgSrcLower.includes("panui.png")) statusText = "החניון פנוי";
      else if (imgSrcLower.includes("meat.png")) statusText = "מעט מקומות";
      else if (imgSrcLower.includes("sagur.png") || imgSrcLower.includes("closed.png")) statusText = "החניון סגור";
    }
    const statsCollectionRef = db.collection("public_parking_stats");
    await statsCollectionRef.add({
      timestamp: new Date(),
      lotId: lot.id,
      lotName: lot.name,
      status: statusText,
    });
    console.log(`Logged status for ${lot.name}: ${statusText}`);
  } catch (error) {
    console.error(`Failed for lot ${lot.id} (${lot.name}):`, error.message);
    throw error;
  }
}

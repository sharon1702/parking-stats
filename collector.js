import admin from 'firebase-admin';
import axios from 'axios';
import { JSDOM } from 'jsdom';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

const parkingLots = [
  { id: 122, name: "חניון אסותא" },
  { id: 3, name: "חניון בזל" },
];

async function fetchSingleParkingStatus(lot) {
  const targetUrl = `https://www.ahuzot.co.il/Parking/ParkingDetails/?ID=${lot.id}`;
  try {
    const response = await axios.get(targetUrl, { timeout: 20000 });
    const htmlText = response.data;
    if (!htmlText) {
      console.error(`Empty response for lot ${lot.id}`);
      return;
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
    console.log(`Successfully logged status for ${lot.name}: ${statusText}`);
  } catch (error) {
    console.error(`Failed to fetch status for lot ${lot.id} (${lot.name}):`, error.message);
    throw error;
  }
}

console.log("Starting parking stats collection job...");
const fetchPromises = parkingLots.map(lot => fetchSingleParkingStatus(lot));

try {
  await Promise.all(fetchPromises);
  console.log("Parking stats collection job finished successfully.");
} catch (error) {
  console.error("An error occurred during stats collection. Exiting with failure.");
  process.exit(1);
}

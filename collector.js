import admin from 'firebase-admin';
import axios from 'axios';
import { JSDOM } from 'jsdom';

// --- התקנת Firebase ---
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --- רשימת החניונים ---
const parkingLots = [
  { id: 122, name: "חניון אסותא" },
  { id: 3, name: "חניון בזל" },
  // הוסף עוד חניונים כאן במידת הצורך
];

/**
 * פונקציה זו בודקת סטטוס של חניון יחיד וכותבת ל-DB.
 * היא מטפלת בשגיאות באופן פנימי ולא זורקת אותן החוצה.
 */
async function fetchSingleParkingStatus(lot) {
  const targetUrl = `https://www.ahuzot.co.il/Parking/ParkingDetails/?ID=${lot.id}`;
  
  // --- FIX: הגדלת זמן ההמתנה ל-45 שניות ---
  const requestTimeout = 45000; 

  try {
    const response = await axios.get(targetUrl, { timeout: requestTimeout });
    const htmlText = response.data;
    if (!htmlText) {
      console.error(`Empty response for lot ${lot.id} (${lot.name})`);
      return false; // החזרת כישלון
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
    return true; // החזרת הצלחה

  } catch (error) {
    // --- FIX: רישום השגיאה מבלי לעצור את כל התהליך ---
    console.error(`Failed to fetch status for lot ${lot.id} (${lot.name}): ${error.message}`);
    return false; // החזרת כישלון
  }
}

/**
 * פונקציית ריצה ראשית שמנהלת את כל התהליך
 */
async function runCollectionJob() {
  console.log("Starting parking stats collection job...");
  let successCount = 0;

  // --- FIX: לולאה על כל חניון בנפרד במקום Promise.all ---
  // זה מבטיח שכישלון בחניון אחד לא עוצר את הבדיקה של האחרים.
  for (const lot of parkingLots) {
    const result = await fetchSingleParkingStatus(lot);
    if (result) {
      successCount++;
    }
    // המתן שנייה בין בקשה לבקשה כדי לא להעמיס על השרת
    await new Promise(resolve => setTimeout(resolve, 1000)); 
  }

  // --- FIX: בדיקה אם *כל* הריצות נכשלו ---
  if (successCount === 0 && parkingLots.length > 0) {
    console.error("All parking lots failed to fetch. Exiting with failure.");
    process.exit(1); // צא עם שגיאה רק אם *הכל* נכשל
  } else if (successCount < parkingLots.length) {
    console.warn(`Parking stats collection job finished with ${parkingLots.length - successCount} partial failures.`);
  } else {
    console.log("Parking stats collection job finished successfully.");
  }
}

// --- הפעלת התהליך ---
runCollectionJob().catch(err => {
  console

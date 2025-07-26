import admin from 'firebase-admin';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function analyzeStats() {
  console.log('Starting analysis...');
  const rawStatsSnapshot = await db.collection('public_parking_stats').get();

  const aggregatedData = {};

  rawStatsSnapshot.forEach(doc => {
    const data = doc.data();
    const date = data.timestamp.toDate();

    // --- FIX: Convert timestamp to Israeli timezone before extracting parts ---
    // This correctly handles DST (UTC+2 / UTC+3)
    const hourString = date.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false });
    let hour = parseInt(hourString, 10);
    if (hour === 24) hour = 0; // Normalize midnight from 24 to 0

    const dayString = date.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'long' });
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dayOfWeek = days.indexOf(dayString); // This gives 0 for Sunday, etc.

    const lotId = data.lotId;
    const status = data.status;

    const key = `${lotId}_${dayOfWeek}`;
    if (!aggregatedData[key]) {
      aggregatedData[key] = {
        lotId: lotId,
        lotName: data.lotName,
        dayOfWeek: dayOfWeek,
        hourlyStats: {}
      };
    }

    if (!aggregatedData[key].hourlyStats[hour]) {
      aggregatedData[key].hourlyStats[hour] = {
        'החניון פנוי': 0,
        'מעט מקומות': 0,
        'החניון מלא': 0,
        'החניון סגור': 0,
        'סטטוס לא ידוע': 0,
        totalSamples: 0
      };
    }

    if (aggregatedData[key].hourlyStats[hour][status] !== undefined) {
        aggregatedData[key].hourlyStats[hour][status]++;
    }
    aggregatedData[key].hourlyStats[hour].totalSamples++;
  });

  console.log('Analysis complete. Writing to Firestore...');
  const batch = db.batch();
  const analysisCollectionRef = db.collection('analyzed_parking_stats');

  for (const key in aggregatedData) {
    const docRef = analysisCollectionRef.doc(key);
    batch.set(docRef, aggregatedData[key]);
  }

  await batch.commit();
  console.log('Successfully wrote analysis to Firestore.');
}

analyzeStats().catch(error => {
  console.error("Error during analysis:", error);
  process.exit(1);
});

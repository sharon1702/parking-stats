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
    const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday...
    const hour = date.getHours();
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

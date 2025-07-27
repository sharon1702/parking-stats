import admin from 'firebase-admin';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --- FIX: Map Hebrew statuses to stable English keys ---
const STATUS_MAP = {
  "החניון מלא": "full",
  "החניון פנוי": "available",
  "מעט מקומות": "few",
  "החניון סגור": "closed",
  "סטטוס לא ידוע": "unknown"
};

async function analyzeStats() {
  console.log('Starting duration-based analysis...');
  const rawStatsSnapshot = await db.collection('public_parking_stats').orderBy('timestamp', 'asc').get();

  const statsByLot = {};
  rawStatsSnapshot.forEach(doc => {
      const data = doc.data();
      if (!statsByLot[data.lotId]) {
          statsByLot[data.lotId] = [];
      }
      statsByLot[data.lotId].push(data);
  });

  const aggregatedData = {};
  const MAX_DURATION_MINUTES = 20;

  for (const lotId in statsByLot) {
      const lotStats = statsByLot[lotId];
      for (let i = 0; i < lotStats.length - 1; i++) {
          const currentSample = lotStats[i];
          const nextSample = lotStats[i + 1];

          const startTime = currentSample.timestamp.toDate();
          const endTime = nextSample.timestamp.toDate();

          let durationMillis = endTime.getTime() - startTime.getTime();

          if (durationMillis > MAX_DURATION_MINUTES * 60 * 1000) {
              durationMillis = MAX_DURATION_MINUTES * 60 * 1000;
          }

          const status = currentSample.status;
          const statusKey = STATUS_MAP[status] || 'unknown';

          const hour = parseInt(startTime.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }).replace('24', '0'));
          const dayOfWeek = startTime.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'long' });
          const dayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(dayOfWeek);

          const key = `${lotId}_${dayIndex}`;
          if (!aggregatedData[key]) {
              aggregatedData[key] = {
                  lotId: currentSample.lotId,
                  lotName: currentSample.lotName,
                  dayOfWeek: dayIndex,
                  hourlyStats: {}
              };
          }

          if (!aggregatedData[key].hourlyStats[hour]) {
              aggregatedData[key].hourlyStats[hour] = {
                  available: 0,
                  few: 0,
                  full: 0,
                  closed: 0,
                  unknown: 0,
                  totalDuration: 0
              };
          }

          if (aggregatedData[key].hourlyStats[hour][statusKey] !== undefined) {
              aggregatedData[key].hourlyStats[hour][statusKey] += durationMillis;
          }
          aggregatedData[key].hourlyStats[hour].totalDuration += durationMillis;
      }
  }

  console.log('Analysis complete. Writing to Firestore...');
  const batch = db.batch();
  const analysisCollectionRef = db.collection('analyzed_parking_stats');

  const oldAnalysisSnapshot = await analysisCollectionRef.get();
  oldAnalysisSnapshot.forEach(doc => batch.delete(doc.ref));

  for (const key in aggregatedData) {
      const docRef = analysisCollectionRef.doc(key);
      batch.set(docRef, aggregatedData[key]);
  }

  await batch.commit();
  console.log('Successfully wrote duration-based analysis to Firestore.');
}

analyzeStats().catch(error => {
  console.error("Error during analysis:", error);
  process.exit(1);
});

// analyzer.js
import admin from 'firebase-admin';

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// --- Map Hebrew statuses to stable English keys ---
const STATUS_MAP = {
  "החניון מלא": "full",
  "החניון פנוי": "available",
  "מעט מקומות": "few",
  "החניון סגור": "closed",
  "סטטוס לא ידוע": "unknown"
};

// --- FIX: Use a meta document to track the last successful run timestamp ---
const LAST_RUN_DOC_ID = 'last_successful_run';

async function analyzeAndAggregate() {
  console.log("Starting incremental analysis...");

  let lastRunTimestamp = new Date(0);
  const metaDocRef = db.collection('analysis_meta').doc(LAST_RUN_DOC_ID);
  const metaDoc = await metaDocRef.get();

  if (metaDoc.exists) {
    lastRunTimestamp = metaDoc.data().timestamp.toDate();
  }

  // --- FIX: Fetch only new raw data entries since the last run ---
  const rawStatsSnapshot = await db.collection('public_parking_stats')
    .where('timestamp', '>', lastRunTimestamp)
    .orderBy('timestamp', 'asc')
    .get();

  if (rawStatsSnapshot.empty) {
    console.log("No new data to analyze. Exiting.");
    return;
  }
  
  const newRawStats = [];
  rawStatsSnapshot.forEach(doc => newRawStats.push(doc.data()));

  const aggregatedData = {};
  const MAX_DURATION_MINUTES = 20;

  for (let i = 0; i < newRawStats.length - 1; i++) {
    const currentSample = newRawStats[i];
    const nextSample = newRawStats[i + 1];

    const startTime = currentSample.timestamp.toDate();
    const endTime = nextSample.timestamp.toDate();
    
    // Calculate the duration
    let durationMillis = endTime.getTime() - startTime.getTime();
    if (durationMillis > MAX_DURATION_MINUTES * 60 * 1000) {
      durationMillis = MAX_DURATION_MINUTES * 60 * 1000;
    }
    
    const status = currentSample.status;
    const statusKey = STATUS_MAP[status] || 'unknown';

    // Get date and time details in Israel time zone
    const dayOfWeek = startTime.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', weekday: 'long' });
    const dayIndex = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].indexOf(dayOfWeek);
    const hour = parseInt(startTime.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }).replace('24', '0'));
    
    const lotId = currentSample.lotId;
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

  console.log('Analysis complete. Updating Firestore...');
  const analysisCollectionRef = db.collection('analyzed_parking_stats');
  const batch = db.batch();

  // --- FIX: Read existing aggregated data to update it instead of overwriting ---
  const existingAnalysisSnapshot = await analysisCollectionRef.get();
  const existingAnalysisData = {};
  existingAnalysisSnapshot.forEach(doc => {
      existingAnalysisData[doc.id] = doc.data();
  });
  
  for (const key in aggregatedData) {
    const docRef = analysisCollectionRef.doc(key);
    const newStats = aggregatedData[key];
    const existingStats = existingAnalysisData[key];

    if (existingStats) {
        // Merge the new data with the existing data
        for (const hour in newStats.hourlyStats) {
            if (!existingStats.hourlyStats[hour]) {
                existingStats.hourlyStats[hour] = { available: 0, few: 0, full: 0, closed: 0, unknown: 0, totalDuration: 0 };
            }
            const newHourStats = newStats.hourlyStats[hour];
            const existingHourStats = existingStats.hourlyStats[hour];
            
            existingHourStats.available += newHourStats.available;
            existingHourStats.few += newHourStats.few;
            existingHourStats.full += newHourStats.full;
            existingHourStats.closed += newHourStats.closed;
            existingHourStats.unknown += newHourStats.unknown;
            existingHourStats.totalDuration += newHourStats.totalDuration;
        }
        batch.set(docRef, existingStats); // Use set to update the entire document
    } else {
        // If the document doesn't exist, create it with the new data
        batch.set(docRef, newStats);
    }
  }

  // --- FIX: Commit changes and then update the timestamp ---
  await batch.commit();

  // --- FIX: Update the last successful run timestamp after a successful commit ---
  await metaDocRef.set({ timestamp: new Date() });

  console.log('Successfully updated incremental analysis to Firestore.');
}

analyzeAndAggregate().catch(error => {
  console.error("Error during analysis:", error);
  process.exit(1);
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { token, lastFetchDate } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });

  const start = lastFetchDate
    ? new Date(new Date(lastFetchDate).getTime() + 24*60*60*1000).toISOString().split('T')[0]
    : new Date(Date.now() - 365*24*60*60*1000).toISOString().split('T')[0];
  const end = new Date().toISOString().split('T')[0];

  if(start > end) return res.status(200).json({ data: [] });

  const params = `start_date=${start}&end_date=${end}`;
  const headers = { 'Authorization': `Bearer ${token}` };

  try {
    const [readiness, sleep, activity, sleepDetail] = await Promise.all([
      fetch(`https://api.ouraring.com/v2/usercollection/daily_readiness?${params}`, {headers}).then(r=>r.json()),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_sleep?${params}`, {headers}).then(r=>r.json()),
      fetch(`https://api.ouraring.com/v2/usercollection/daily_activity?${params}`, {headers}).then(r=>r.json()),
      fetch(`https://api.ouraring.com/v2/usercollection/sleep?${params}`, {headers}).then(r=>r.json()),
    ]);

    const merged = {};

    (readiness.data||[]).forEach(d => {
      merged[d.day] = {
        date: d.day,
        readiness_score: d.score,
        resting_hr: d.contributors?.resting_heart_rate,
        recovery_index: d.contributors?.recovery_index,
        temperature_deviation: d.temperature_deviation,
      };
    });

    (sleep.data||[]).forEach(d => {
      if(!merged[d.day]) merged[d.day] = {date: d.day};
      merged[d.day].sleep_score = d.score;
      merged[d.day].deep_sleep_duration = d.contributors?.deep_sleep;
      merged[d.day].awake_time = d.contributors?.total_sleep;
    });
    
if(sleepDetail.data?.length > 0) console.log("sleepDetail keys:", Object.keys(sleepDetail.data[0]));
    // HRV(ms)はsleepエンドポイントから取得
    (sleepDetail.data||[]).forEach(d => {
      const day = d.day;
      if(!merged[day]) merged[day] = {date: day};
      if(d.average_hrv != null) merged[day].hrv_average = d.average_hrv;
    });

    (activity.data||[]).forEach(d => {
      if(!merged[d.day]) merged[d.day] = {date: d.day};
      merged[d.day].activity_score = d.score;
      merged[d.day].steps = d.steps;
      if(d.active_calories != null) merged[d.day].activity_burn = d.active_calories;
    });

    res.status(200).json({ data: Object.values(merged) });
  } catch(e) {
    console.error("oura api error:", e);
    res.status(500).json({ error: 'API call failed' });
  }
}
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { token, dataType, startDate, endDate } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  const endpoints = {
    readiness: 'v2/usercollection/daily_readiness',
    sleep: 'v2/usercollection/daily_sleep',
    activity: 'v2/usercollection/daily_activity',
  };
  const endpoint = endpoints[dataType] || endpoints.readiness;
  const params = new URLSearchParams({
    start_date: startDate || new Date(Date.now() - 30*24*60*60*1000).toISOString().split('T')[0],
    end_date: endDate || new Date().toISOString().split('T')[0],
  });
  try {
    const r = await fetch(`https://api.ouraring.com/${endpoint}?${params}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!r.ok) return res.status(r.status).json({ error: 'Oura API error' });
    res.status(200).json(await r.json());
  } catch {
    res.status(500).json({ error: 'API call failed' });
  }
}
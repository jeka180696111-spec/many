// Vercel serverless — serve Paddle client-side config (safe to expose)
export default function handler(req, res) {
  const token = process.env.PADDLE_CLIENT_TOKEN;
  if (!token) return res.status(500).json({ error: 'PADDLE_CLIENT_TOKEN not configured' });

  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
  res.json({
    token,
    environment: process.env.PADDLE_ENV || 'sandbox',
    prices: {
      week:  process.env.PADDLE_PRICE_WEEK  || null,
      month: process.env.PADDLE_PRICE_MONTH || null,
      year:  process.env.PADDLE_PRICE_YEAR  || null,
    },
  });
}

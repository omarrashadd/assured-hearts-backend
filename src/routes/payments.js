const express = require('express');
const { pool } = require('../db');
const { calculatePricing, getPricingConfig } = require('../pricing');

const router = express.Router();
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? require('stripe')(stripeSecret) : null;
const DEFAULT_CURRENCY = 'cad';

function getCheckoutOrigin(req){
  return req.headers.origin || process.env.FRONTEND_URL || process.env.FRONTEND_BASE_URL || null;
}

function buildSuccessUrl(origin, requestId){
  return `${origin}/parent-dashboard.html?checkout=success&request_id=${encodeURIComponent(requestId)}&session_id={CHECKOUT_SESSION_ID}`;
}

function buildCancelUrl(origin, requestId){
  return `${origin}/parent-dashboard.html?checkout=cancel&request_id=${encodeURIComponent(requestId)}`;
}

router.post('/checkout', async (req, res) => {
  const requestId = parseInt(req.body?.requestId || req.body?.request_id, 10);
  const userId = parseInt(req.body?.userId || req.body?.user_id, 10);
  if(!requestId) return res.status(400).json({ error: 'requestId is required' });
  if(!stripe) return res.status(500).json({ error: 'Stripe is not configured.' });
  if(!pool) return res.status(500).json({ error: 'Database not configured.' });

  try{
    const { rows } = await pool.query('SELECT * FROM childcare_requests WHERE id=$1', [requestId]);
    const reqRow = rows[0];
    if(!reqRow) return res.status(404).json({ error: 'Request not found' });
    if(userId && reqRow.parent_id !== userId){
      return res.status(403).json({ error: 'Not authorized for this request' });
    }
    const statusKey = (reqRow.status || '').toLowerCase();
    if(statusKey !== 'accepted' && statusKey !== 'confirmed'){
      return res.status(400).json({ error: 'Checkout is available after caregiver accepts.' });
    }
    const paymentStatus = (reqRow.payment_status || '').toLowerCase();
    if(paymentStatus === 'paid'){
      return res.json({ paid: true });
    }

    const pricingConfig = await getPricingConfig();
    const pricing = calculatePricing({
      age: reqRow.child_age,
      care_type: reqRow.care_type,
      is_premium: reqRow.is_premium,
      start_at: reqRow.start_at,
      end_at: reqRow.end_at,
      province: reqRow.pricing_province
    }, pricingConfig);
    const amountCents = pricing.total_booking_cents;
    await pool.query(
      'UPDATE childcare_requests SET payment_amount_cents=$1, hourly_rate_cents=$2, pricing_snapshot=$3 WHERE id=$4',
      [amountCents, pricing.total_hourly_cents, pricing, requestId]
    );

    const origin = getCheckoutOrigin(req);
    if(!origin){
      return res.status(400).json({ error: 'Checkout origin not available.' });
    }

    const { rows: userRows } = await pool.query('SELECT email FROM users WHERE id=$1', [reqRow.parent_id]);
    const email = userRows[0]?.email || null;
    const metadata = {
      requestId: String(requestId),
      parentId: String(reqRow.parent_id || ''),
      providerId: String(reqRow.provider_id || '')
    };
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: DEFAULT_CURRENCY,
            product_data: {
              name: 'Childcare booking',
              description: reqRow.location ? `Care at ${reqRow.location}` : 'Assured Hearts booking'
            },
            unit_amount: amountCents
          },
          quantity: 1
        }
      ],
      success_url: buildSuccessUrl(origin, requestId),
      cancel_url: buildCancelUrl(origin, requestId),
      customer_email: email || undefined,
      client_reference_id: String(requestId),
      metadata,
      payment_intent_data: { metadata }
    });

    await pool.query(
      'UPDATE childcare_requests SET payment_intent_id=$1, payment_status=$2, payment_currency=$3 WHERE id=$4',
      [session.payment_intent || null, 'checkout_open', DEFAULT_CURRENCY, requestId]
    );

    return res.json({ url: session.url, sessionId: session.id });
  }catch(err){
    console.error('Checkout session error:', err);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

router.post('/checkout/confirm', async (req, res) => {
  const sessionId = req.body?.sessionId || req.body?.session_id;
  const userId = parseInt(req.body?.userId || req.body?.user_id, 10);
  if(!sessionId) return res.status(400).json({ error: 'sessionId is required' });
  if(!stripe) return res.status(500).json({ error: 'Stripe is not configured.' });
  if(!pool) return res.status(500).json({ error: 'Database not configured.' });

  try{
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
    const requestIdRaw = session?.metadata?.requestId || session?.client_reference_id;
    const requestId = parseInt(requestIdRaw, 10);
    if(!requestId) return res.status(400).json({ error: 'Request not found for session' });

    const { rows } = await pool.query('SELECT * FROM childcare_requests WHERE id=$1', [requestId]);
    const reqRow = rows[0];
    if(!reqRow) return res.status(404).json({ error: 'Request not found' });
    if(userId && reqRow.parent_id !== userId){
      return res.status(403).json({ error: 'Not authorized for this request' });
    }

    const paymentIntent = session.payment_intent || null;
    const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null;
    const paid = session.payment_status === 'paid' || paymentIntent?.status === 'succeeded';
    const amountCents = session.amount_total || paymentIntent?.amount || reqRow.payment_amount_cents || null;
    const currency = session.currency || paymentIntent?.currency || DEFAULT_CURRENCY;
    const statusValue = paid ? 'paid' : (session.payment_status || 'unpaid');

    await pool.query(
      'UPDATE childcare_requests SET payment_status=$1, payment_intent_id=COALESCE($2, payment_intent_id), payment_amount_cents=COALESCE($3, payment_amount_cents), payment_currency=COALESCE($4, payment_currency), status=CASE WHEN $1=$5 THEN $6 ELSE status END WHERE id=$7',
      [statusValue, paymentIntentId, amountCents, currency, 'paid', 'confirmed', requestId]
    );

    return res.json({ status: statusValue, paid, sessionStatus: session.status });
  }catch(err){
    console.error('Checkout confirm error:', err);
    return res.status(500).json({ error: 'Failed to confirm checkout' });
  }
});

module.exports = router;

const express = require('express');
const { pool } = require('../db');
const { calculatePricing, getPricingConfig } = require('../pricing');

const router = express.Router();
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
const stripe = stripeSecret ? require('stripe')(stripeSecret) : null;
const DEFAULT_CURRENCY = 'cad';

async function getOrCreateCustomerId(parentId){
  if(!pool || !stripe || !parentId) return null;
  const { rows } = await pool.query('SELECT stripe_customer_id, email, name FROM users WHERE id=$1', [parentId]);
  const row = rows[0];
  if(!row) return null;
  if(row.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripe.customers.create({
    email: row.email || undefined,
    name: row.name || undefined,
    metadata: { parentId: String(parentId) }
  });
  await pool.query('UPDATE users SET stripe_customer_id=$1 WHERE id=$2', [customer.id, parentId]);
  return customer.id;
}

router.get('/config', (req, res) => {
  if(!publishableKey){
    return res.status(500).json({ error: 'Stripe publishable key is not configured.' });
  }
  return res.json({ publishableKey });
});

router.post('/methods/list', async (req, res) => {
  const userId = parseInt(req.body?.userId || req.body?.user_id, 10);
  if(!userId) return res.status(400).json({ error: 'userId is required' });
  if(!pool) return res.status(500).json({ error: 'Database not configured.' });
  try{
    const { rows } = await pool.query(
      'SELECT id, stripe_payment_method_id, label, brand, last4, exp_month, exp_year, is_default FROM payment_methods WHERE parent_id=$1 ORDER BY is_default DESC, created_at DESC',
      [userId]
    );
    return res.json({ methods: rows });
  }catch(err){
    console.error('List payment methods error:', err);
    return res.status(500).json({ error: 'Failed to load payment methods' });
  }
});

router.post('/methods/setup', async (req, res) => {
  const userId = parseInt(req.body?.userId || req.body?.user_id, 10);
  if(!userId) return res.status(400).json({ error: 'userId is required' });
  if(!stripe) return res.status(500).json({ error: 'Stripe is not configured.' });
  if(!pool) return res.status(500).json({ error: 'Database not configured.' });
  try{
    const customerId = await getOrCreateCustomerId(userId);
    if(!customerId) return res.status(500).json({ error: 'Unable to create customer.' });
    const intent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: { parentId: String(userId) }
    });
    return res.json({ clientSecret: intent.client_secret, setupIntentId: intent.id });
  }catch(err){
    console.error('Setup intent error:', err);
    return res.status(500).json({ error: 'Failed to create setup intent' });
  }
});

router.post('/methods/save', async (req, res) => {
  const userId = parseInt(req.body?.userId || req.body?.user_id, 10);
  const setupIntentId = req.body?.setupIntentId || req.body?.setup_intent_id;
  const label = (req.body?.label || '').trim();
  const makeDefault = !!req.body?.makeDefault;
  if(!userId) return res.status(400).json({ error: 'userId is required' });
  if(!setupIntentId) return res.status(400).json({ error: 'setupIntentId is required' });
  if(!stripe) return res.status(500).json({ error: 'Stripe is not configured.' });
  if(!pool) return res.status(500).json({ error: 'Database not configured.' });

  try{
    const intent = await stripe.setupIntents.retrieve(setupIntentId);
    if(intent.status !== 'succeeded' || !intent.payment_method){
      return res.status(400).json({ error: 'Setup not completed', status: intent.status });
    }
    const pmId = intent.payment_method;
    const pm = await stripe.paymentMethods.retrieve(pmId);
    const card = pm.card || {};
    const labelValue = label || 'Card';

    const { rows: existingRows } = await pool.query(
      'SELECT id, is_default FROM payment_methods WHERE parent_id=$1 AND stripe_payment_method_id=$2',
      [userId, pmId]
    );

    let methodId = null;
    if(existingRows.length){
      methodId = existingRows[0].id;
      await pool.query(
        'UPDATE payment_methods SET label=$1, brand=$2, last4=$3, exp_month=$4, exp_year=$5 WHERE id=$6',
        [labelValue, card.brand || null, card.last4 || null, card.exp_month || null, card.exp_year || null, methodId]
      );
    } else {
      const { rows } = await pool.query(
        'INSERT INTO payment_methods(parent_id, stripe_payment_method_id, label, brand, last4, exp_month, exp_year, is_default) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
        [userId, pmId, labelValue, card.brand || null, card.last4 || null, card.exp_month || null, card.exp_year || null, false]
      );
      methodId = rows[0]?.id;
    }

    const { rows: defaultRows } = await pool.query(
      'SELECT id FROM payment_methods WHERE parent_id=$1 AND is_default=true LIMIT 1',
      [userId]
    );
    const shouldDefault = makeDefault || defaultRows.length === 0;
    if(shouldDefault && methodId){
      await pool.query('UPDATE payment_methods SET is_default=false WHERE parent_id=$1', [userId]);
      await pool.query('UPDATE payment_methods SET is_default=true WHERE id=$1 AND parent_id=$2', [methodId, userId]);
    }

    return res.json({
      success: true,
      methodId,
      stripePaymentMethodId: pmId,
      label: labelValue,
      brand: card.brand || null,
      last4: card.last4 || null,
      exp_month: card.exp_month || null,
      exp_year: card.exp_year || null,
      is_default: shouldDefault
    });
  }catch(err){
    console.error('Save payment method error:', err);
    return res.status(500).json({ error: 'Failed to save payment method' });
  }
});

router.post('/methods/default', async (req, res) => {
  const userId = parseInt(req.body?.userId || req.body?.user_id, 10);
  const methodIdRaw = req.body?.methodId || req.body?.method_id;
  if(!userId) return res.status(400).json({ error: 'userId is required' });
  if(!methodIdRaw) return res.status(400).json({ error: 'methodId is required' });
  if(!pool) return res.status(500).json({ error: 'Database not configured.' });

  try{
    let methodRow = null;
    if(String(methodIdRaw).startsWith('pm_')){
      const { rows } = await pool.query(
        'SELECT id FROM payment_methods WHERE parent_id=$1 AND stripe_payment_method_id=$2',
        [userId, methodIdRaw]
      );
      methodRow = rows[0];
    } else {
      const methodId = parseInt(methodIdRaw, 10);
      const { rows } = await pool.query(
        'SELECT id FROM payment_methods WHERE parent_id=$1 AND id=$2',
        [userId, methodId]
      );
      methodRow = rows[0];
    }
    if(!methodRow) return res.status(404).json({ error: 'Payment method not found' });

    await pool.query('UPDATE payment_methods SET is_default=false WHERE parent_id=$1', [userId]);
    await pool.query('UPDATE payment_methods SET is_default=true WHERE id=$1 AND parent_id=$2', [methodRow.id, userId]);
    return res.json({ success: true });
  }catch(err){
    console.error('Set default error:', err);
    return res.status(500).json({ error: 'Failed to set default method' });
  }
});

router.post('/methods/rename', async (req, res) => {
  const userId = parseInt(req.body?.userId || req.body?.user_id, 10);
  const methodIdRaw = req.body?.methodId || req.body?.method_id;
  const label = (req.body?.label || '').trim();
  if(!userId) return res.status(400).json({ error: 'userId is required' });
  if(!methodIdRaw) return res.status(400).json({ error: 'methodId is required' });
  if(!label) return res.status(400).json({ error: 'label is required' });
  if(!pool) return res.status(500).json({ error: 'Database not configured.' });
  try{
    let methodRow = null;
    if(String(methodIdRaw).startsWith('pm_')){
      const { rows } = await pool.query(
        'SELECT id FROM payment_methods WHERE parent_id=$1 AND stripe_payment_method_id=$2',
        [userId, methodIdRaw]
      );
      methodRow = rows[0];
    } else {
      const methodId = parseInt(methodIdRaw, 10);
      const { rows } = await pool.query(
        'SELECT id FROM payment_methods WHERE parent_id=$1 AND id=$2',
        [userId, methodId]
      );
      methodRow = rows[0];
    }
    if(!methodRow) return res.status(404).json({ error: 'Payment method not found' });
    await pool.query('UPDATE payment_methods SET label=$1 WHERE id=$2 AND parent_id=$3', [label, methodRow.id, userId]);
    return res.json({ success: true });
  }catch(err){
    console.error('Rename method error:', err);
    return res.status(500).json({ error: 'Failed to rename method' });
  }
});

router.post('/methods/remove', async (req, res) => {
  const userId = parseInt(req.body?.userId || req.body?.user_id, 10);
  const methodIdRaw = req.body?.methodId || req.body?.method_id;
  if(!userId) return res.status(400).json({ error: 'userId is required' });
  if(!methodIdRaw) return res.status(400).json({ error: 'methodId is required' });
  if(!pool) return res.status(500).json({ error: 'Database not configured.' });

  try{
    let methodRow = null;
    if(String(methodIdRaw).startsWith('pm_')){
      const { rows } = await pool.query(
        'SELECT id, stripe_payment_method_id, is_default FROM payment_methods WHERE parent_id=$1 AND stripe_payment_method_id=$2',
        [userId, methodIdRaw]
      );
      methodRow = rows[0];
    } else {
      const methodId = parseInt(methodIdRaw, 10);
      const { rows } = await pool.query(
        'SELECT id, stripe_payment_method_id, is_default FROM payment_methods WHERE parent_id=$1 AND id=$2',
        [userId, methodId]
      );
      methodRow = rows[0];
    }
    if(!methodRow) return res.status(404).json({ error: 'Payment method not found' });

    if(stripe && methodRow.stripe_payment_method_id){
      try{
        await stripe.paymentMethods.detach(methodRow.stripe_payment_method_id);
      }catch(err){
        console.warn('Stripe detach failed:', err.message);
      }
    }
    await pool.query('DELETE FROM payment_methods WHERE id=$1 AND parent_id=$2', [methodRow.id, userId]);

    if(methodRow.is_default){
      const { rows } = await pool.query(
        'SELECT id FROM payment_methods WHERE parent_id=$1 ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      if(rows[0]?.id){
        await pool.query('UPDATE payment_methods SET is_default=true WHERE id=$1 AND parent_id=$2', [rows[0].id, userId]);
      }
    }
    return res.json({ success: true });
  }catch(err){
    console.error('Remove method error:', err);
    return res.status(500).json({ error: 'Failed to remove method' });
  }
});

router.post('/setup-intent', async (req, res) => {
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
    if(reqRow.payment_method_id){
      return res.json({ setupComplete: true });
    }

    const customerId = await getOrCreateCustomerId(reqRow.parent_id);
    if(!customerId){
      return res.status(500).json({ error: 'Unable to create customer.' });
    }

    if(reqRow.payment_setup_intent_id){
      const existing = await stripe.setupIntents.retrieve(reqRow.payment_setup_intent_id);
      if(existing.status === 'succeeded' && existing.payment_method){
        await pool.query(
          'UPDATE childcare_requests SET payment_method_id=$1, payment_status=$2 WHERE id=$3',
          [existing.payment_method, 'payment_method_saved', requestId]
        );
        return res.json({ setupComplete: true });
      }
      if(['requires_payment_method','requires_action','requires_confirmation'].includes(existing.status)){
        return res.json({ clientSecret: existing.client_secret });
      }
    }

    const intent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: { requestId: String(requestId), parentId: String(reqRow.parent_id || '') }
    });
    await pool.query(
      'UPDATE childcare_requests SET payment_setup_intent_id=$1, payment_status=$2 WHERE id=$3',
      [intent.id, 'needs_payment_method', requestId]
    );
    return res.json({ clientSecret: intent.client_secret });
  }catch(err){
    console.error('Setup intent error:', err);
    return res.status(500).json({ error: 'Failed to create setup intent' });
  }
});

router.post('/setup-confirm', async (req, res) => {
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
    if(!reqRow.payment_setup_intent_id){
      return res.status(400).json({ error: 'Setup intent not found' });
    }
    const intent = await stripe.setupIntents.retrieve(reqRow.payment_setup_intent_id);
    if(intent.status === 'succeeded' && intent.payment_method){
      await pool.query(
        'UPDATE childcare_requests SET payment_method_id=$1, payment_status=$2 WHERE id=$3',
        [intent.payment_method, 'payment_method_saved', requestId]
      );
    }
    return res.json({ status: intent.status });
  }catch(err){
    console.error('Setup confirm error:', err);
    return res.status(500).json({ error: 'Failed to confirm setup' });
  }
});

router.post('/intent', async (req, res) => {
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
    const paymentStatus = (reqRow.payment_status || '').toLowerCase();
    if(statusKey !== 'accepted' && statusKey !== 'confirmed'){
      return res.status(400).json({ error: 'Payment available after caregiver accepts.' });
    }
    let paymentIntentId = reqRow.payment_intent_id;
    let amountCents = reqRow.payment_amount_cents;
    let currency = reqRow.payment_currency || DEFAULT_CURRENCY;

    if(paymentStatus === 'paid'){
      return res.json({ paid: true });
    }

    if(!paymentIntentId){
      if(!reqRow.payment_method_id){
        return res.status(400).json({ error: 'No payment method on file.' });
      }
      const customerId = await getOrCreateCustomerId(reqRow.parent_id);
      const pricingConfig = await getPricingConfig();
      const pricing = calculatePricing({
        age: reqRow.child_age,
        care_type: reqRow.care_type,
        is_premium: reqRow.is_premium,
        start_at: reqRow.start_at,
        end_at: reqRow.end_at,
        province: reqRow.pricing_province
      }, pricingConfig);
      amountCents = pricing.total_booking_cents;
      await pool.query(
        'UPDATE childcare_requests SET payment_amount_cents=$1, hourly_rate_cents=$2, pricing_snapshot=$3 WHERE id=$4',
        [amountCents, pricing.total_hourly_cents, pricing, requestId]
      );
      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency,
        customer: customerId || undefined,
        automatic_payment_methods: { enabled: true },
        metadata: {
          requestId: String(requestId),
          parentId: String(reqRow.parent_id || ''),
          providerId: String(reqRow.provider_id || '')
        }
      });
      paymentIntentId = intent.id;
      await pool.query(
        'UPDATE childcare_requests SET payment_intent_id=$1, payment_status=$2, payment_amount_cents=$3, payment_currency=$4 WHERE id=$5',
        [intent.id, intent.status, amountCents, currency, requestId]
      );
      return res.json({ clientSecret: intent.client_secret, amountCents, currency, paid: intent.status === 'succeeded' });
    }

    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const normalizedStatus = intent.status === 'succeeded' ? 'paid' : intent.status;
    await pool.query(
      'UPDATE childcare_requests SET payment_status=$1, payment_amount_cents=COALESCE(payment_amount_cents, $2), payment_currency=COALESCE(payment_currency, $3) WHERE id=$4',
      [normalizedStatus, intent.amount, intent.currency, requestId]
    );
    return res.json({ clientSecret: intent.client_secret, amountCents: intent.amount, currency: intent.currency, paid: intent.status === 'succeeded' });
  }catch(err){
    console.error('Payment intent error:', err);
    return res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

router.post('/charge', async (req, res) => {
  const requestId = parseInt(req.body?.requestId || req.body?.request_id, 10);
  const userId = parseInt(req.body?.userId || req.body?.user_id, 10);
  const methodRaw = req.body?.paymentMethodId || req.body?.payment_method_id;
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
      return res.status(400).json({ error: 'Charge is available after caregiver accepts.' });
    }
    if((reqRow.payment_status || '').toLowerCase() === 'paid'){
      return res.json({ status: 'paid' });
    }

    let paymentMethodId = reqRow.payment_method_id;
    if(methodRaw){
      const raw = String(methodRaw);
      if(raw.startsWith('pm_')){
        const { rows: pmRows } = await pool.query(
          'SELECT stripe_payment_method_id FROM payment_methods WHERE parent_id=$1 AND stripe_payment_method_id=$2',
          [reqRow.parent_id, raw]
        );
        if(pmRows.length === 0){
          return res.status(400).json({ error: 'Invalid payment method' });
        }
        paymentMethodId = raw;
      } else {
        const methodId = parseInt(raw, 10);
        if(Number.isFinite(methodId)){
          const { rows: pmRows } = await pool.query(
            'SELECT stripe_payment_method_id FROM payment_methods WHERE parent_id=$1 AND id=$2',
            [reqRow.parent_id, methodId]
          );
          if(pmRows.length === 0){
            return res.status(400).json({ error: 'Invalid payment method' });
          }
          paymentMethodId = pmRows[0].stripe_payment_method_id;
        }
      }
    }

    if(!paymentMethodId){
      return res.status(400).json({ error: 'No payment method on file.' });
    }

    await pool.query('UPDATE childcare_requests SET payment_method_id=$1 WHERE id=$2', [paymentMethodId, requestId]);

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
    const customerId = await getOrCreateCustomerId(reqRow.parent_id);

    try{
      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: DEFAULT_CURRENCY,
        customer: customerId || undefined,
        payment_method: paymentMethodId,
        confirm: true,
        off_session: true,
        metadata: {
          requestId: String(requestId),
          parentId: String(reqRow.parent_id || ''),
          providerId: String(reqRow.provider_id || '')
        }
      });
      await pool.query(
        'UPDATE childcare_requests SET payment_intent_id=$1, payment_status=$2, payment_amount_cents=$3, payment_currency=$4, status=$5 WHERE id=$6',
        [intent.id, 'paid', amountCents, DEFAULT_CURRENCY, 'confirmed', requestId]
      );
      return res.json({ status: 'paid' });
    }catch(err){
      const intent = err?.payment_intent;
      if(intent){
        const nextStatus = intent.status === 'requires_action' ? 'requires_action' : intent.status || 'failed';
        await pool.query(
          'UPDATE childcare_requests SET payment_intent_id=$1, payment_status=$2, payment_amount_cents=$3, payment_currency=$4 WHERE id=$5',
          [intent.id, nextStatus, intent.amount || amountCents, intent.currency || DEFAULT_CURRENCY, requestId]
        );
        return res.json({ status: nextStatus });
      }
      await pool.query('UPDATE childcare_requests SET payment_status=$1 WHERE id=$2', ['failed', requestId]);
      return res.json({ status: 'failed' });
    }
  }catch(err){
    console.error('Charge error:', err);
    return res.status(500).json({ error: 'Failed to charge payment method' });
  }
});

router.post('/confirm', async (req, res) => {
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
    if(!reqRow.payment_intent_id){
      return res.status(400).json({ error: 'Payment intent not found' });
    }
    const intent = await stripe.paymentIntents.retrieve(reqRow.payment_intent_id);
    const paid = intent.status === 'succeeded';
    await pool.query(
      'UPDATE childcare_requests SET payment_status=$1, payment_amount_cents=COALESCE(payment_amount_cents, $2), payment_currency=COALESCE(payment_currency, $3), status=CASE WHEN $1=$4 THEN $5 ELSE status END WHERE id=$6',
      [paid ? 'paid' : intent.status, intent.amount, intent.currency, 'paid', 'confirmed', requestId]
    );
    return res.json({ status: paid ? 'paid' : intent.status });
  }catch(err){
    console.error('Payment confirm error:', err);
    return res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

module.exports = router;

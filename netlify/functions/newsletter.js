/**
 * POST /newsletter — Handles newsletter subscriptions
 *
 * SETUP OPTIONS:
 * Option A: Mailchimp — Add MAILCHIMP_API_KEY and MAILCHIMP_LIST_ID env vars
 * Option B: Klaviyo — Add KLAVIYO_API_KEY env var
 * Option C: Resend audiences
 */

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '' };

  try {
    const { email } = JSON.parse(event.body || '{}');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Valid email required' }) };
    }

    // ---- MAILCHIMP (Option A) ----
    // const mailchimp = require('@mailchimp/mailchimp_marketing');
    // mailchimp.setConfig({ apiKey: process.env.MAILCHIMP_API_KEY, server: 'us1' });
    // await mailchimp.lists.addListMember(process.env.MAILCHIMP_LIST_ID, {
    //   email_address: email, status: 'subscribed',
    //   tags: ['website-signup'],
    // });

    console.log('Newsletter signup:', email);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error('Newsletter error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Subscription failed' }) };
  }
};

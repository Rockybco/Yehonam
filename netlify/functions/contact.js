/**
 * POST /contact — Handles contact form submissions
 *
 * SETUP OPTIONS (choose one):
 * Option A: Resend (recommended) — Add RESEND_API_KEY env var
 * Option B: SendGrid — Add SENDGRID_API_KEY env var
 * Option C: Use Netlify Forms (simplest — no code needed, see note below)
 *
 * NETLIFY FORMS NOTE:
 * Alternatively, add data-netlify="true" to your <form> tag
 * and Netlify handles submissions automatically in the dashboard.
 * No serverless function needed for basic form submission.
 */

exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const { name, email, phone, subject, message } = JSON.parse(event.body || '{}');

    if (!name || !email || !message) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name, email and message are required' }) };
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email address' }) };
    }

    // ---- RESEND INTEGRATION (Option A) ----
    // npm install resend
    // const { Resend } = require('resend');
    // const resend = new Resend(process.env.RESEND_API_KEY);
    // await resend.emails.send({
    //   from: 'website@yehonam.com',
    //   to: 'support@yehonam.com',
    //   subject: `New Contact Form: ${subject || 'General Enquiry'} — from ${name}`,
    //   html: `
    //     <h2>New Contact Form Submission</h2>
    //     <p><strong>Name:</strong> ${name}</p>
    //     <p><strong>Email:</strong> ${email}</p>
    //     <p><strong>Phone:</strong> ${phone || 'Not provided'}</p>
    //     <p><strong>Subject:</strong> ${subject || 'General'}</p>
    //     <p><strong>Message:</strong></p>
    //     <p>${message}</p>
    //   `,
    //   reply_to: email,
    // });

    // ---- SENDGRID INTEGRATION (Option B) ----
    // npm install @sendgrid/mail
    // const sgMail = require('@sendgrid/mail');
    // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    // await sgMail.send({
    //   to: 'support@yehonam.com',
    //   from: 'website@yehonam.com',
    //   subject: `New Enquiry: ${subject || 'General'} — ${name}`,
    //   html: `<p>From: ${name} (${email})</p><p>${message}</p>`,
    // });

    // Log for now — replace with one of the options above
    console.log('Contact form submission:', { name, email, subject, messageLength: message.length });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (error) {
    console.error('Contact form error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to send message' }) };
  }
};

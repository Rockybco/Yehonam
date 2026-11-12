# Yehonam Suds, Hair & Body — Website Setup Guide

## Overview
Full e-commerce website built with HTML, CSS, Vanilla JS and Stripe.  
Hosted on Netlify with serverless functions for secure Stripe operations.

---

## Project Structure

```
yehonam-suds/
├── index.html              Homepage
├── about.html              About page
├── shop.html               Shop page
├── contact.html            Contact page
├── product.html            Individual product template
├── cart.html               Shopping cart
├── confirmation.html       Order confirmation
├── faq.html                FAQ page
├── privacy.html            Privacy Policy
├── terms.html              Terms & Conditions
├── shipping.html           Shipping & Returns
├── sitemap.xml             SEO sitemap
├── robots.txt              Search engine rules
├── netlify.toml            Netlify deployment config
├── package.json            Node.js dependencies
├── css/
│   └── style.css           Complete brand stylesheet
├── js/
│   ├── cart.js             Shopping cart (localStorage)
│   ├── shop.js             Stripe product loader
│   └── main.js             Navigation, forms, general UI
└── netlify/
    └── functions/
        ├── get-products.js     Fetches product list from Stripe
        ├── get-product.js      Fetches single product from Stripe
        ├── create-checkout.js  Creates Stripe Checkout Session
        ├── webhook.js          Handles Stripe webhook events
        ├── verify-order.js     Verifies completed payment
        ├── contact.js          Contact form handler
        └── newsletter.js       Newsletter subscription handler
```

---

## Step 1: Stripe Setup

### 1.1 Create a Stripe account
Go to https://stripe.com and sign up or log in.

### 1.2 Add products in Stripe Dashboard
Go to Products → Add product.

For each product, add these metadata fields:
| Field | Example Value | Purpose |
|-------|---------------|---------|
| category | haircare | Category filtering |
| featured | true | Homepage featured section |
| bestseller | true | Bestseller badge |
| new | true | New product badge |
| display_order | 1 | Sort order on shop page |
| short_description | Nourishing hair oil for all hair types | Short description |
| sizes | 100ml, 250ml, 500ml | Size options (comma-separated) |
| benefits | Strengthens hair... | Benefits tab |
| ingredients | Argan oil, vitamin E... | Ingredients tab |
| directions | Apply to damp hair... | Directions tab |
| original_price | 2500 | Original price in pence (for sale display) |

### 1.3 Get your API keys
Stripe Dashboard → Developers → API keys

You need:
- Publishable key (starts with pk_)
- Secret key (starts with sk_) — NEVER put this in frontend code

---

## Step 2: Deploy to Netlify

### 2.1 Create a Netlify account
Go to https://netlify.com and sign up.

### 2.2 Deploy the site
Option A — Drag and drop:
1. Go to Netlify → Sites
2. Drag the entire yehonam-suds folder onto the deploy area

Option B — GitHub (recommended for ongoing updates):
1. Push the folder to a GitHub repository
2. Connect the repo in Netlify → New site from Git
3. Build command: `npm install`
4. Publish directory: `.` (the root)

### 2.3 Add environment variables
In Netlify: Site settings → Environment variables → Add a variable

Add these:
| Variable | Value | Where to find |
|----------|-------|---------------|
| STRIPE_SECRET_KEY | sk_live_... | Stripe Dashboard → Developers → API keys |
| STRIPE_WEBHOOK_SECRET | whsec_... | Step 3 below |
| SITE_URL | https://yourdomain.com | Your actual domain |

---

## Step 3: Set Up Stripe Webhook

### 3.1 Add webhook endpoint
Stripe Dashboard → Developers → Webhooks → Add endpoint

Endpoint URL: `https://your-netlify-site.netlify.app/.netlify/functions/webhook`

Events to listen for:
- checkout.session.completed
- payment_intent.succeeded
- payment_intent.payment_failed
- charge.refunded

### 3.2 Get the webhook secret
After creating the endpoint, Stripe shows a signing secret (whsec_...).
Add this as STRIPE_WEBHOOK_SECRET in Netlify environment variables.

---

## Step 4: Configure the Site

### 4.1 Update WhatsApp number
Search all HTML files for `1234567890` and replace with the actual WhatsApp business number (international format, no + or spaces).
Example: +44 7700 900000 → becomes 447700900000

### 4.2 Add hero image
In index.html, replace the `.hero-placeholder` div with:
```html
<img src="images/hero.jpg" alt="Beautiful woman holding Yehonam Suds product">
```
Recommended: Professional studio photo, woman on right, product visible, warm tones.

### 4.3 Add category images
Replace the emoji placeholders in the category cards with actual product photography.

### 4.4 Update domain in sitemap.xml
Replace `https://yehonam.com` with the actual domain.

### 4.5 Set up contact form email
In netlify/functions/contact.js, uncomment one of the email integrations:
- Resend (recommended): npm install resend, add RESEND_API_KEY env var
- SendGrid: npm install @sendgrid/mail, add SENDGRID_API_KEY env var
- OR: add `data-netlify="true"` to the contact form tag for free Netlify Forms

### 4.6 Set up newsletter (optional)
In netlify/functions/newsletter.js, uncomment the Mailchimp or Klaviyo integration.

---

## Step 5: Test Everything

### 5.1 Test payments (use Stripe test mode first)
Use test card: 4242 4242 4242 4242
Expiry: any future date
CVC: any 3 digits

### 5.2 Test checklist
- [ ] Homepage loads and products appear from Stripe
- [ ] Category filters work
- [ ] Product detail pages load
- [ ] Add to cart works (count updates in nav)
- [ ] Cart shows correct items and totals
- [ ] Checkout redirects to Stripe
- [ ] Stripe test payment completes
- [ ] Confirmation page shows
- [ ] Contact form sends
- [ ] Mobile layout works
- [ ] All nav links work

### 5.3 Switch to live mode
Once testing is complete:
1. Replace sk_test_... with sk_live_... in Netlify env vars
2. Create a new webhook endpoint for live mode (separate from test)
3. Replace whsec_test_... with the live whsec_...

---

## Ongoing Product Management (Georgina)

Georgina manages all products through Stripe Dashboard:
- **Add products**: Products → Add product
- **Upload images**: Add up to 8 images per product
- **Change prices**: Products → select product → Pricing → Edit
- **Write descriptions**: Products → select product → Description
- **Archive products**: Products → select product → Archive (removes from site instantly)
- **Issue refunds**: Payments → select payment → Refund
- **View orders**: Payments tab
- **Apply discounts**: Promotions → Coupon codes

No code editing required for any of the above.

---

## Support
Email: support@yehonam.com

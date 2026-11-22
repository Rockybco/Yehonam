# Yehonam Suds, Hair & Body — Website Setup Guide

## Overview
Full e-commerce website built with HTML, CSS, Vanilla JS and Stripe.  
Hosted on Vercel with serverless functions for secure Stripe operations.

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
├── vercel.json             Vercel deployment config (build, headers, pretty URLs)
├── package.json            Node.js dependencies
├── css/
│   └── style.css           Complete brand stylesheet
├── js/
│   ├── cart.js             Shopping cart (localStorage)
│   ├── shop.js             Stripe product loader
│   ├── confirmation.js     Verifies the Stripe Checkout Session
│   └── main.js             Navigation, general UI
└── api/                    Vercel serverless functions
    ├── get-products.js     Fetches product list from Stripe
    ├── get-product.js      Fetches single product from Stripe
    ├── create-checkout.js  Creates Stripe Checkout Session
    ├── verify-order.js     Verifies completed payment
    └── webhook.js          Handles Stripe webhook events
```

---

## Step 1: Stripe Setup

### 1.1 Create a Stripe account
Go to https://stripe.com and sign up or log in.

### 1.2 Add products in Stripe Dashboard
Go to Products → Add product.

For each product, add these optional metadata fields:
| Field | Example Value | Purpose |
|-------|---------------|---------|
| category | haircare | Category filtering |
| featured | true | Homepage featured section |
| bestseller | true | Bestseller badge |
| new | true | New product badge |
| display_order | 1 | Sort order on shop page |
| short_description | Nourishing hair oil for all hair types | Short description fallback |
| benefits | Strengthens hair... | Benefits tab |
| ingredients | Argan oil, vitamin E... | Ingredients tab |
| directions | Apply to damp hair... | Directions tab |
| original_price | 2500 | Original price in US cents (for sale display) |

Product names, descriptions and images come from the Stripe product itself.
Products with no active, one-time USD Price are hidden from the shop.

### 1.3 Add prices and variants
Every product needs at least one **active, one-time, USD** Price. Set one Price
as the product's **default price**; that is the price shown on shop cards.

For size or variant options, create a separate Price for each option:
- Put the label in the Price **nickname**, for example `100 ml` or `250 ml`.
- Alternatively add `size`, `variant` or `label` Price metadata.
- A Price without a nickname or variant metadata still works, but its button
  shows the formatted amount.

Do not use a `sizes` product metadata field for purchasing. Variant buttons map
to real Stripe Price IDs, and checkout always sends the selected Price ID. An
inactive price is ignored.

### 1.4 Get your API keys
Stripe Dashboard → Developers → API keys

You need:
- Secret key (starts with sk_) — NEVER put this in frontend code

`STRIPE_PUBLISHABLE_KEY` is not used: checkout is created server-side and the
browser redirects to Stripe's hosted payment page. Use test keys (`sk_test_...`)
until every item in Section 5 passes.

---

## Step 2: Deploy to Vercel

The repo is fully configured for Vercel — `vercel.json` handles the build,
security headers and pretty URLs. The serverless functions live in `api/`.

### 2.1 Import the project
1. Push this repo to GitHub
2. Vercel dashboard → Add New → Project → import the repo (framework preset: Other)
3. Deploy — no build configuration needed (install command is `npm install --omit=dev`)

### 2.2 Add environment variables
In Vercel: Project → Settings → Environment Variables

Add these:
| Variable | Value | Where to find |
|----------|-------|---------------|
| STRIPE_SECRET_KEY | sk_test_... while testing, sk_live_... when live | Stripe Dashboard → Developers → API keys |
| STRIPE_WEBHOOK_SECRET | whsec_... | Step 3 below |
| SITE_URL | https://yehonam.com | Your live site URL (no trailing slash) |

### 2.3 Local development (optional)
Run `npm run dev` (starts `vercel dev` — the first run asks you to log in and
link the project). Copy `.env.example` to `.env` and fill in test values so the
API routes work locally. A plain static server can render the HTML/CSS/JS, but
the Stripe endpoints need `vercel dev`.

### 2.4 Redeploys
Every push to `main` triggers an automatic Vercel deployment.

---

## Step 3: Set Up Stripe Webhook

### 3.1 Add webhook endpoint
Stripe Dashboard → Developers → Webhooks → Add endpoint

Endpoint URL: `https://yehonam.com/api/webhook`

Events to listen for:
- checkout.session.completed
- payment_intent.payment_failed
- charge.refunded

The endpoint verifies the Stripe signature against the raw request body. It
does not store orders, send email or deduplicate retries; events are written to
Vercel logs only. Order confirmation on the website is verified separately by
`/api/verify-order`.

### 3.2 Get the webhook secret
After creating the endpoint, Stripe shows a signing secret (whsec_...).
Add this as STRIPE_WEBHOOK_SECRET in Vercel environment variables.

---

## Step 4: Configure the Site

### 4.1 Update WhatsApp number
The WhatsApp number is currently **+1 470 554 9465** (`14705549465` in the
`wa.me` links). To change it, search all HTML files for `14705549465` and
replace with the new number in international format (no +, spaces or symbols).
Example: +44 7700 900000 → becomes 447700900000

### 4.2 Add hero image
In index.html, replace the `.hero-placeholder` div with:
```html
<img src="images/hero.jpg" alt="Beautiful woman holding Yehonam Suds product">
```
Recommended: Professional studio photo, woman on right, product visible, warm tones.

### 4.3 Add category images
Replace the emoji placeholders in the category cards with actual product photography.

### 4.4 Domain
The site uses `https://yehonam.com` in canonical links, `sitemap.xml` and
`robots.txt`. Keep `yehonam.com` set as the **Primary** domain in Vercel so
`www.yehonam.com` redirects to it. If the domain changes, update those references.

---

## Step 5: Test Everything

### 5.1 Test payments (use Stripe test mode first)
Use test card: 4242 4242 4242 4242
Expiry: any future date
CVC: any 3 digits

Declined test card: 4000 0000 0000 9995

### 5.2 Test checklist
- [ ] Homepage loads featured products from Stripe
- [ ] Shop loads all products that have an active USD one-time Price
- [ ] Products with no active price are hidden
- [ ] Category filters and search work
- [ ] Product images, descriptions and metadata appear
- [ ] Variant buttons select different Stripe Price IDs, and each lands in the cart as its own line
- [ ] Add to cart works (count updates in nav)
- [ ] Cart shows correct items and totals; the shipping line explains that delivery charges are communicated separately by the business
- [ ] Removing an item and changing quantities works, with the 10-per-line limit
- [ ] Checkout total equals the products in the cart; no flat shipping rates are added (Stripe collects the shipping address during checkout)
- [ ] Checkout button disables while the session is created, and cannot be double-submitted
- [ ] Checkout redirects to Stripe
- [ ] A completed test payment reaches confirmation.html
- [ ] Confirmation shows success only for a paid session, with reference, email and amount
- [ ] The cart clears only after verified payment
- [ ] A pending or declined payment does not show success or clear the cart
- [ ] Refreshing confirmation re-verifies the same order
- [ ] Stripe webhook delivery returns 200 and appears in Vercel logs
- [ ] Mobile layout works
- [ ] All nav links work

Note: this project has no order database or email service. The confirmation page
reads the Checkout Session from Stripe each time it loads. Stripe can send
receipts if you enable them in the Dashboard.

### 5.3 Switch to live mode
Only after every item above passes in test mode:
1. Replace sk_test_... with sk_live_... in Vercel env vars
2. Create a separate live webhook endpoint and set STRIPE_WEBHOOK_SECRET to its signing secret
3. Confirm SITE_URL is `https://yehonam.com` and that the apex domain is Primary in Vercel
4. Redeploy and repeat a low-value live purchase and refund

---

## Ongoing Product Management (Georgina)

Georgina manages all products through Stripe Dashboard:
- **Add products**: Products → Add product, then add at least one active one-time USD Price
- **Add variants**: Add one Price per size/option and set the Price nickname
- **Set card price**: Choose the product's default Price
- **Upload images**: Add up to 8 images per product
- **Change prices**: Products → select product → Pricing → Edit
- **Write descriptions**: Products → select product → Description
- **Archive products**: Products → select product → Archive (removes from site)
- **Issue refunds**: Payments → select payment → Refund
- **View orders**: Payments tab
- **Apply discounts**: Promotions → Coupon codes

No code editing required for any of the above.

---

## Support
Email: support@yehonam.com

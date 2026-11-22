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
├── lib/
│   └── email.js            Transactional order-confirmation email
├── tests/
│   └── yehonam-api-tests.js Mocked API and email tests
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

### 1.5 Checkout creation and delivery charges
The browser sends only Stripe Price IDs and quantities to
`POST /api/create-checkout`. The server re-checks every Price against Stripe
and rejects inactive, recurring, non-USD or inactive-product Prices. Amounts
always come from Stripe, never from the browser.

Checkout totals are **product-only**. Stripe collects the shipping address
during checkout, but no shipping options or flat shipping rates are added. Any
applicable delivery charges are communicated separately by the Yehonam team.

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

| Variable | Placeholder value | Required | Purpose |
|----------|-------------------|----------|---------|
| `STRIPE_SECRET_KEY` | `sk_test_REPLACE_WITH_YOUR_SECRET_KEY` | Yes | Stripe Checkout, product APIs, session verification and webhook processing. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_REPLACE_WITH_YOUR_WEBHOOK_SECRET` | Yes for webhook | Raw-body Stripe signature verification in `/api/webhook`. |
| `SITE_URL` | `https://yehonam.com` | Yes for checkout | Canonical origin used to build Stripe success/cancel URLs. No trailing slash. |
| `SMTP_HOST` | `smtp.hostinger.com` | Yes for email | Hostinger SMTP host used by `lib/email.js`. |
| `SMTP_PORT` | `465` | No | SMTP port. Defaults to `465` when omitted or invalid. |
| `SMTP_SECURE` | `true` | No | Set `true` for implicit TLS on port 465. Defaults from `SMTP_PORT`; set `false` only for the mail provider's non-465 STARTTLS configuration. |
| `SMTP_USER` | `REPLACE_WITH_HOSTINGER_SMTP_USERNAME` | Yes for email | SMTP authentication username. |
| `SMTP_PASS` | `REPLACE_WITH_HOSTINGER_SMTP_PASSWORD` | Yes for email | SMTP authentication password. Never commit this value. |
| `EMAIL_FROM` | `orders@example.com` | Yes for email | Verified sender address used on transactional receipts. |
| `EMAIL_FROM_NAME` | `Yehonam Suds` | No | Sender display name. Defaults to `Yehonam Suds`. |

Copy `.env.example` to `.env` only for local development. Keep real secrets in
Vercel environment variables and never commit `.env`, API keys, webhook secrets
or SMTP passwords.

### 2.3 Local development (optional)
Run `npm run dev` (starts `vercel dev` — the first run asks you to log in and
link the project). Copy `.env.example` to `.env` and fill in test values so the
API routes work locally. A plain static server can render the HTML/CSS/JS, but
the Stripe endpoints need `vercel dev`.

### 2.4 Redeploys
Every push to `main` triggers an automatic Vercel deployment.

---

## Step 3: Stripe Webhook, Email and Order Verification

### 3.1 Add webhook endpoint
Stripe Dashboard → Developers → Webhooks → Add endpoint

Endpoint URL: `https://yehonam.com/api/webhook`

Events to listen for:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`

`/api/webhook` verifies the Stripe signature against the raw request body. For
`checkout.session.completed` and `checkout.session.async_payment_succeeded`, it
re-retrieves the Checkout Session with expanded line items and PaymentIntent and
sends the order confirmation email **only** when Stripe reports
`payment_status === 'paid'`. Unpaid and `no_payment_required` sessions do not
receive an email.

Failed payments and refunds are logged only. There is no order database.

### 3.2 Duplicate-email protection
`lib/email.js` stores `yehonam_order_email_status: 'sent'` in PaymentIntent
metadata after a successful send. It also uses in-process `sentSessionIds` and
`inFlight` sets to suppress repeated deliveries while the serverless instance is
warm. This reduces duplicate emails without a database.

Because there is no durable order store or distributed lock, a cold start, a
second instance, or a rare failure to persist the metadata marker after SMTP
success can still allow a duplicate. Do not claim stronger guarantees than this.

If SMTP sending fails, the webhook returns a non-2xx response so Stripe retries
the delivery. The PaymentIntent metadata marker is not written on SMTP failure.

### 3.3 Hostinger SMTP and sender configuration
Order confirmation emails are sent from `lib/email.js` using Nodemailer and the
Hostinger SMTP environment variables listed in Step 2.2. Configure
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`
and optionally `EMAIL_FROM_NAME` in Vercel. Use a verified sender address in
`EMAIL_FROM`; never put real credentials in the repository.

The email contains a branded HTML receipt with inline CSS and a plain-text
alternative. It uses `https://www.yehonam.com/images/logo-email.png` because
Gmail and Outlook block SVG images. The PNG must be deployed with the site.

### 3.4 Website payment verification
A redirect from Stripe is not proof of payment. `confirmation.html` calls
`/api/verify-order`, which re-retrieves the Checkout Session from Stripe and
returns order data. It sets `verified: true` only when `payment_status === 'paid'`.
The confirmation page renders the success receipt and clears the cart
only after that verified result. `/api/verify-order` never sends email.

### 3.5 Get the webhook secret
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

### 4.4 Domain and canonical host
The canonical domain is `https://yehonam.com`. It is used in `SITE_URL`, the
documented webhook endpoint, canonical links, `sitemap.xml` and `robots.txt`.
Keep `yehonam.com` set as the **Primary** domain in Vercel so
`https://www.yehonam.com` redirects to it. Confirm that redirect after any
domain or Vercel configuration change.

The receipt intentionally uses the brand-approved `https://www.yehonam.com`
forms for the website, shop and email logo URLs. With the redirect in place they
resolve to the same canonical site. If the redirect is removed, update those
receipt links only after brand approval.

---

## Step 5: Test Everything

### 5.1 Test payments (use Stripe test mode first)
Use test card: 4242 4242 4242 4242
Expiry: any future date
CVC: any 3 digits

Declined test card: 4000 0000 0000 9995

### 5.2 Test checklist
Run the mocked automated suite first:

```bash
npm test
```

The suite uses Stripe and SMTP mocks. It does not require live credentials and
does not send real email.

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
- [ ] A paid `checkout.session.completed` event sends one order confirmation email
- [ ] A paid `checkout.session.async_payment_succeeded` event sends one order confirmation email
- [ ] Unpaid and `no_payment_required` sessions do not send an order confirmation email
- [ ] Replayed webhook deliveries are deduplicated by PaymentIntent metadata
- [ ] SMTP failure causes a retryable webhook response and does not mark the email as sent
- [ ] `https://www.yehonam.com/images/logo-email.png` returns 200 after deployment
- [ ] Mobile layout works
- [ ] All nav links work

Note: this project has no order database. The confirmation page reads the
Checkout Session from Stripe each time it loads. Order confirmation emails are
sent by the Stripe webhook through Hostinger SMTP; see Step 3. Stripe receipts
can also be enabled separately in the Stripe Dashboard.

### 5.3 Switch to live mode
Only after every item above passes in test mode:
1. Replace `sk_test_...` with `sk_live_...` in Vercel env vars
2. Create a separate live webhook endpoint and set `STRIPE_WEBHOOK_SECRET` to its signing secret
3. Confirm `SITE_URL` is `https://yehonam.com` and that the apex domain is Primary in Vercel
4. Confirm all Hostinger SMTP variables are set in Vercel and `EMAIL_FROM` is verified
5. Deploy with `images/logo-email.png` included and verify its public URL returns 200
6. Redeploy and repeat a low-value live purchase and refund

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

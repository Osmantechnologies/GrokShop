# eBay Buy API application — Grokshop (draft for the owner to submit)

Where: join the eBay Partner Network (https://partnernetwork.ebay.com) as a publisher, then submit the **Buy API
Application** linked from https://developer.ebay.com/api-docs/buy/buy-requirements.html. After EPN approves, open a
developer support ticket titled **"Buy API Production Access (<your eBay user ID>)"**.

Copy the answers below into the form. Edit anything that is not true for you before sending.

---

**Company / app name:** Grokshop (https://grokazon.app)

**Contact on X:** @AdeliaCmartins

**APIs requested:** Browse API (production). Order API checkout (member checkout or guest checkout with the "Checkout
with eBay" widget), so shoppers can buy eBay items without leaving Grokshop.

**Business model (short):**
Grokshop is a shopping site with an AI shopping assistant (Grok) built in. Shoppers describe what they need ("wireless
headphones under $150, delivered this week"); the assistant searches participating sources and explains each option:
price, shipping cost and time, return policy and seller feedback. We want eBay listings to be one of those sources, with
purchases completed through eBay's own checkout so eBay sellers are paid by eBay and eBay's buyer protection applies.
We earn through the eBay Partner Network (affiliate tracking on every eBay item link and checkout).

**How eBay items are shown:**
- Fixed-price (Buy It Now) items only, delivered within the same country as the marketplace (EBAY_US).
- eBay-hosted item image, the seller's eBay username and feedback percentage, full title (shortened titles show the full
  title on hover), Buy It Now price with shipping shown separately (also when free), the eBay logo next to every eBay item.
- Search results from eBay keep eBay's order. Our assistant may add a short explanation of why an item fits the shopper's
  request; we ask eBay to confirm whether the assistant may highlight one eBay item as its suggestion, and we will follow
  eBay's answer.
- Our footer links to the eBay User Agreement and to our privacy policy (https://grokazon.app/privacy.html).

**Checkout:** through eBay's Order API checkout session (or the Checkout with eBay widget for guests). We collect the
buyer's email and full billing and shipping address only as eBay's checkout requires, and we never show the guest purchase
order ID. Grokshop does not take payment for eBay items.

**Data:** item data is fetched live per search and kept only briefly to show results; we do not resell or publish eBay data
outside the shopping flow.

**Volume estimate:** launch phase, under 5,000 Browse API calls per day.

**Sandbox:** the integration is built and reviewable on the eBay sandbox (we will share a test URL on request).

---

Notes for the owner (do not paste):
- You chose "Grokshop checkout for everything". eBay's rules make eBay items pay through eBay's own checkout (inside
  Grokshop, via their API or widget). Grokshop sellers and Shopify stores still use Grokshop's Stripe checkout.
- eBay says partners may not re-sort eBay results. The application asks eBay directly whether Grok may highlight a pick.
- Approval is not guaranteed and can take weeks. Real Grokshop sellers can go live before it.

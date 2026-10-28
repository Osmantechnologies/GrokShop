// The catalogue filter, in code, before any model sees anything: keywords (with shopping synonyms), a price ceiling
// and the category. Real fields only. Used by /ask (then one model call) and /match (no model).

const STOP = new Set('a an the me my i for to of and or in on with under below less than max up best good find get buy some any that this which is are be by it its new please want need looking delivered delivery ship ships shipped week this next day days fast cheap cheapest price budget around about usd dollars every weeks month restock'.split(' '));

// what people type -> words that appear in the catalogue
const SYN = {
  headphones: ['headphone', 'earphone', 'earphones', 'airpods', 'earbuds', 'beats'], headphone: ['headphones'], earbuds: ['earphones', 'airpods', 'beats'], earphones: ['airpods', 'beats', 'earbuds'], wireless: [],
  audio: ['earphones', 'airpods', 'speaker', 'homepod', 'echo'], speaker: ['homepod', 'echo'],
  phone: ['smartphones', 'smartphone', 'iphone'], smartphone: ['smartphones'], iphone: ['smartphones'], laptop: ['laptops'], tablet: ['tablets', 'ipad'],
  desk: ['furniture'], chair: ['furniture'], sofa: ['furniture'], bed: ['furniture'], table: ['furniture'],
  coffee: ['coffee', 'nescafe'], groceries: ['groceries'], food: ['groceries'],
  watch: ['watches', 'watch'], shoes: ['shoes', 'sneakers'], sneakers: ['shoes'], bag: ['bags', 'handbag'], dress: ['dresses'], shirt: ['shirts'],
  perfume: ['fragrances'], fragrance: ['fragrances'], makeup: ['beauty', 'mascara', 'lipstick'], skincare: ['skin-care'], sunglasses: ['sunglasses'],
  kitchen: ['kitchen-accessories'], gift: [], jewellery: ['jewellery', 'earring', 'necklace'], jewelry: ['jewellery'], earrings: ['earring'],
  sports: ['sports-accessories', 'ball'], gym: ['sports-accessories'], charger: ['charger', 'magsafe'], camera: ['camera']
};

export function parseAsk(q) {
  const s = String(q || '').toLowerCase();
  let max = null;
  const m = s.match(/(?:under|below|less than|max(?:imum)?|up to|no more than|<)\s*\$?\s*(\d[\d,]*(?:\.\d+)?)/) || s.match(/\$\s*(\d[\d,]*(?:\.\d+)?)/);
  if (m) max = parseFloat(m[1].replace(/,/g, ''));
  const words = s.replace(/\$\s*\d[\d,.]*/g, ' ').match(/[a-z][a-z0-9+-]*/g) || [];
  const terms = [...new Set(words.filter(w => w.length > 2 && !STOP.has(w)))];
  const expanded = new Set(terms);
  terms.forEach(t => (SYN[t] || SYN[t.replace(/s$/, '')] || []).forEach(x => expanded.add(x)));
  const fast = /\b(this week|by (mon|tues|wednes|thurs|fri|satur|sun)day|tomorrow|asap|fast|overnight|in \d+ days?)\b/.test(s);
  return { max, terms, words: [...expanded], fast };
}

export function merchantOf(p) { return p.merchant || ((p.brand ? p.brand : titleCase(p.category.replace(/-/g, ' '))) + ' store'); }
function titleCase(s) { return s.replace(/\b\w/g, c => c.toUpperCase()); }

// score every product; return the candidates (within budget first, then up to 3 just over it as alternatives)
export function matchCatalogue(products, q, limit = 12) {
  const a = parseAsk(q);
  const scored = [];
  for (const p of products) {
    const title = p.title.toLowerCase(), cat = p.category.toLowerCase(), tags = (p.tags || []).join(' ').toLowerCase(), brand = (p.brand || '').toLowerCase(), desc = (p.description || '').toLowerCase();
    let score = 0;
    for (const w of a.words) {
      const re = new RegExp('\\b' + w.replace(/[^a-z0-9]/g, '') + 's?\\b');
      if (re.test(title)) score += 3;
      if (re.test(cat) || re.test(tags)) score += 2;
      if (brand && re.test(brand)) score += 2;
      if (re.test(desc)) score += 1;
    }
    if (score > 0) scored.push({ p, score });
  }
  scored.sort((x, y) => y.score - x.score || (y.p.rating || 0) - (x.p.rating || 0));
  const top = scored.length ? scored[0].score : 0;
  const strong = scored.filter(x => x.score >= Math.max(2, top * 0.4));
  const inBudget = strong.filter(x => a.max == null || x.p.price <= a.max).slice(0, limit);
  const over = a.max == null ? [] : strong.filter(x => x.p.price > a.max).sort((x, y) => x.p.price - y.p.price).slice(0, 3);
  return { ask: a, considered: strong.length, merchants: new Set(products.map(merchantOf)).size, inBudget: inBudget.map(x => x.p), over: over.map(x => x.p) };
}

// Missions have no model to judge fit, so a product only counts when it really is the thing asked for: one of the
// shopper's own words in its title, tags or category, or a product-level synonym (never a whole category like
// "furniture") in its title or tags. "standing desk" must not report a table lamp.
export function strictFit(products, a) {
  const cats = new Set(products.map(p => p.category));
  const isCat = w => [...cats].some(c => c === w || c.endsWith('-' + w));
  const own = a.terms.map(t => t.replace(/[^a-z0-9]/g, ''));
  const syn = a.words.filter(w => !a.terms.includes(w) && !isCat(w)).map(w => w.replace(/[^a-z0-9]/g, ''));
  const has = (s, w) => new RegExp('\\b' + w + 's?\\b').test(s);
  // brand words ("apple" in "apple airpods") only count when nothing more specific was asked, so the fruit is not a find
  const brands = new Set(products.map(p => (p.brand || '').toLowerCase()).filter(Boolean));
  const specific = own.filter(w => !brands.has(w));
  const key = specific.length || syn.length ? specific : own;
  return p => {
    const tt = (p.title + ' ' + (p.tags || []).join(' ')).toLowerCase(), cat = p.category.toLowerCase();
    return key.some(w => has(tt, w) || has(cat, w)) || syn.some(w => has(tt, w));
  };
}

// what the model sees per product (real fields only)
export function slim(p) {
  return {
    id: p.id, title: p.title, brand: p.brand || null, merchant: merchantOf(p), category: p.category, price: p.price, discountPercentage: p.discountPercentage,
    rating: p.rating, reviews: (p.reviews || []).length, stock: p.stock, availability: p.availabilityStatus, shipping: p.shippingInformation,
    warranty: p.warrantyInformation, returns: p.returnPolicy, description: String(p.description || '').slice(0, 260)
  };
}
export function trustLine(p) {
  if (p.source === 'shopify') return (p.test ? 'Shopify test store' : 'Shopify store') + ' · no ratings yet' + (p.returnPolicy ? ' · ' + p.returnPolicy.toLowerCase() : ' · returns set by the store');
  return p.rating + '★ (' + (p.reviews || []).length + ' reviews) · ' + p.returnPolicy.toLowerCase() + ' · ' + p.warrantyInformation.toLowerCase();
}

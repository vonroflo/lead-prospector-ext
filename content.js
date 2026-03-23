(function(){
"use strict";
if(window.__lpInit)return;window.__lpInit=true;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Known third-party profile/booking platforms (not a real website)
const SOCIAL_DOMAINS = [
  'facebook.com','fb.com','instagram.com','twitter.com','x.com',
  'tiktok.com','youtube.com','linkedin.com','pinterest.com','nextdoor.com',
  'fresha.com','vagaro.com','booksy.com','schedulicity.com','mindbodyonline.com',
  'mindbody.io','squareup.com','square.site','setmore.com','calendly.com',
  'yelp.com','tripadvisor.com','thumbtack.com','angi.com','angieslist.com',
  'homeadvisor.com','bark.com','houzz.com','birdeye.com',
  'doordash.com','ubereats.com','grubhub.com','postmates.com',
  'healthgrades.com','zocdoc.com','vitals.com','realself.com',
  'yellowpages.com','bbb.org','manta.com','chamberofcommerce.com'
];

function isSocialUrl(url){
  try{ const h=new URL(url).hostname.replace(/^www\./,''); return SOCIAL_DOMAINS.some(d=>h===d||h.endsWith('.'+d)); }catch(e){return false;}
}

// Google Maps injects generic booking widget links (same URL for every business in a category).
// These contain rwg_token, /googlemap/, or /reserve/ and are NOT the business's actual profile.
function isGenericBookingLink(url){
  return /rwg_token|\/googlemap\/|\/reserve\?/.test(url);
}

function classifyWebPresence(website, socialLinks){
  const hasRealSite = !!website && !isSocialUrl(website);
  const hasSocial = socialLinks && socialLinks.length > 0;
  if(hasRealSite) return {has_website:true, social_only:false};
  if(hasSocial) return {has_website:false, social_only:true};
  return {has_website:false, social_only:false};
}

function getStatus(has_website, social_only, reviews){
  if(has_website) return "Has Website";
  if(social_only && reviews >= 5) return "HOT LEAD";
  if(social_only) return "SOCIAL ONLY";
  if(reviews >= 5) return "HOT LEAD";
  return "NO WEBSITE";
}

/**
 * Detect which layout Google Maps is using:
 * - "expanded": Service businesses (plumbers, HVAC, etc.) with Website/Directions buttons
 * - "compact": Retail/beauty businesses (nail salons, restaurants) without sidebar details
 */
function detectLayout(){
  const cards = document.querySelectorAll('div.Nv2PK');
  if(!cards.length) return "unknown";
  // Check if first card has "Website"/"Directions" action buttons (a.lcr4fd)
  const hasActionBtns = cards[0].querySelectorAll('a.lcr4fd').length > 0;
  // Check if phone numbers are visible in sidebar text
  const hasPhoneInSidebar = /\(\d{3}\)\s*\d{3}/.test(cards[0].textContent);
  return (hasActionBtns || hasPhoneInSidebar) ? "expanded" : "compact";
}

/**
 * EXPANDED LAYOUT SCRAPER (plumbers, HVAC, tree trimmers, contractors)
 * Website, phone, and address are all visible in the sidebar cards.
 * No need to click into detail panels.
 */
function scrapeExpanded(){
  const results=[], seen=new Set();
  document.querySelectorAll('div.Nv2PK').forEach(item => {
    try {
      const nameEl = item.querySelector('.qBF1Pd') || item.querySelector('.fontHeadlineSmall');
      const name = nameEl ? nameEl.textContent.trim() : '';
      if(!name || seen.has(name.toLowerCase())) return;
      seen.add(name.toLowerCase());

      // Rating & reviews
      let rating=0, reviews=0;
      const starEl = item.querySelector('span[role="img"]');
      if(starEl){
        const label = starEl.getAttribute("aria-label")||"";
        const rm = label.match(/([\d.]+)\s*star/i); if(rm) rating=parseFloat(rm[1]);
        const revm = label.match(/([\d,]+)\s*review/i); if(revm) reviews=parseInt(revm[1].replace(",",""),10);
      }
      if(!reviews){ const m=item.textContent.match(/\(([\d,]+)\)/); if(m) reviews=parseInt(m[1].replace(",",""),10); }

      // Website: multiple strategies to find website link
      let website = '';
      // Strategy 1: action buttons with "Website" text (original class)
      item.querySelectorAll('a.lcr4fd').forEach(a => {
        if((a.textContent||'').trim().toLowerCase().includes('website')){
          website = a.getAttribute('href') || '';
        }
      });
      // Strategy 2: any link with aria-label containing "website"
      if(!website){
        item.querySelectorAll('a[aria-label]').forEach(a => {
          if((a.getAttribute('aria-label')||'').toLowerCase().includes('website')){
            website = a.getAttribute('href') || '';
          }
        });
      }
      // Strategy 3: any link with data-tooltip containing "website"
      if(!website){
        const ttEl = item.querySelector('a[data-tooltip*="website" i], a[data-tooltip*="Website"]');
        if(ttEl) website = ttEl.getAttribute('href') || '';
      }
      // Strategy 4: scan all links for external (non-google) URLs
      const socialLinks = [];
      if(!website){
        item.querySelectorAll('a[href]').forEach(a => {
          const h = a.getAttribute('href')||'';
          if(h.startsWith('http') && !h.includes('google.com') && !h.includes('google.co') && !h.includes('goo.gl') && !h.includes('googleapis.com') && !isGenericBookingLink(h)){
            if(isSocialUrl(h)){
              socialLinks.push(h);
            } else if(!website){
              website = h;
            }
          }
        });
      }

      // Phone: regex from card text
      const pm = item.textContent.match(/\(\d{3}\)\s*\d{3}[- .]?\d{4}/);
      const phone = pm ? pm[0] : '';

      // Address: text after "niche" dot separator, look for street patterns
      let address = '';
      item.querySelectorAll('.W4Efsd span, .fontBodyMedium span').forEach(s => {
        const t = s.textContent.trim();
        if(/^\d+\s+[A-Z]/i.test(t) && t.length > 8 && t.length < 120) address = t;
      });
      // Fallback: broader address match from full text
      if(!address){
        const am = item.textContent.match(/(\d+\s+[\w\s]+(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl|Drive|Street|Avenue|Highway|Hwy|Unit|Suite)[^·\n]{0,40})/i);
        if(am) address = am[1].trim();
      }

      // Category
      let category = '';
      const catEl = item.querySelector('.W4Efsd .W4Efsd span:first-child');
      if(catEl){ const t=catEl.textContent.trim(); if(t && !/^\d/.test(t) && t.length<50 && !t.includes("(")) category=t; }

      // Maps URL
      const linkEl = item.querySelector('a.hfpxzc') || item.querySelector('a[href*="/maps/place/"]');
      const mapsUrl = linkEl ? linkEl.href : '';

      // If "website" is actually a social link, move it to socialLinks
      if(website && isGenericBookingLink(website)){ website=''; }
      if(website && isSocialUrl(website)){ socialLinks.push(website); website=''; }
      const {has_website, social_only} = classifyWebPresence(website, socialLinks);
      const status = getStatus(has_website, social_only, reviews);
      results.push({name, phone, website, rating, reviews, address, category, mapsUrl, has_website, social_only, socialLinks, status});
    } catch(e){}
  });
  return results;
}

/**
 * COMPACT LAYOUT SCRAPER (nail salons, restaurants, med spas, retail)
 * Only names/ratings visible in sidebar. Must click each listing for details.
 */
async function scrapeCompact(maxScrolls){
  // Scroll to load more
  const feed = document.querySelector('div[role="feed"]') || document.querySelector(".m6QErb.DxyBCb");
  if(feed){
    let n=0, ph=feed.scrollHeight;
    while(n < (maxScrolls||5)){
      feed.scrollTop = feed.scrollHeight;
      await sleep(1500);
      if(feed.scrollHeight === ph){ await sleep(800); if(feed.scrollHeight === ph) break; }
      ph = feed.scrollHeight; n++;
    }
    feed.scrollTop = 0;
    await sleep(500);
  }

  const listingLinks = Array.from(document.querySelectorAll('a.hfpxzc'));
  const results = [];
  const seen = new Set();
  const total = listingLinks.length;

  for(let i = 0; i < total; i++){
    const el = listingLinks[i];
    const name = (el.getAttribute("aria-label")||"").trim();
    if(!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    // Get rating/reviews from sidebar
    const c = el.closest("div.Nv2PK") || el.parentElement?.parentElement;
    let rating=0, reviews=0, category="";
    if(c){
      const starEl = c.querySelector('span[role="img"]');
      if(starEl){
        const label = starEl.getAttribute("aria-label")||"";
        const rm = label.match(/([\d.]+)\s*star/i); if(rm) rating=parseFloat(rm[1]);
        const revm = label.match(/([\d,]+)\s*review/i); if(revm) reviews=parseInt(revm[1].replace(",",""),10);
      }
      if(!reviews){ const m=c.textContent.match(/\(([\d,]+)\)/); if(m) reviews=parseInt(m[1].replace(",",""),10); }
      const catEl = c.querySelector(".W4Efsd .W4Efsd span:first-child");
      if(catEl){ const t=catEl.textContent.trim(); if(t && !/^\d/.test(t) && t.length<50 && !t.includes("(")) category=t; }
    }

    // Click into listing and wait for detail panel
    el.scrollIntoView({behavior:"instant", block:"center"});
    await sleep(300);
    el.click();

    // Wait for data-item-id elements to appear (poll up to 5 seconds)
    let found = false;
    for(let w = 0; w < 10; w++){
      await sleep(500);
      if(document.querySelectorAll('[data-item-id]').length > 0){ found=true; break; }
    }

    let phone="", website="", address="";
    const socialLinks = [];

    if(found){
      // ADDRESS
      const addrEl = document.querySelector('button[data-item-id="address"]');
      if(addrEl) address = (addrEl.getAttribute("aria-label")||"").replace(/^Address:\s*/i,"").trim();
      if(!address){ const t = addrEl?.querySelector('.Io6YTe'); if(t) address = t.textContent.trim(); }

      // PHONE
      const phoneEl = document.querySelector('button[data-item-id^="phone:tel:"]');
      if(phoneEl){
        phone = (phoneEl.getAttribute("aria-label")||"").replace(/^Phone:\s*/i,"").trim();
        if(!phone){
          const id = phoneEl.getAttribute("data-item-id")||"";
          const pm = id.match(/phone:tel:(.+)/); if(pm) phone=pm[1];
        }
        if(!phone){ const t = phoneEl.querySelector('.Io6YTe'); if(t) phone=t.textContent.trim(); }
      }

      // WEBSITE — multiple strategies
      // Strategy 1: authority link (standard)
      const webEl = document.querySelector('a[data-item-id="authority"]');
      if(webEl) website = webEl.getAttribute("href")||"";

      // Strategy 2: action links
      if(!website){
        document.querySelectorAll('a[data-item-id^="action:"]').forEach(a => {
          const h = a.getAttribute("href")||"";
          if(h && h.startsWith("http") && !h.includes("google.com") && !isGenericBookingLink(h) && !website) website=h;
        });
      }

      // Strategy 3: aria-label containing "website"
      if(!website){
        document.querySelectorAll('a[aria-label]').forEach(a => {
          const lbl = (a.getAttribute("aria-label")||"").toLowerCase();
          if(lbl.includes("website") && !website){
            website = a.getAttribute("href")||"";
          }
        });
      }

      // Strategy 4: link with text content showing a domain
      if(!website){
        document.querySelectorAll('a[href]').forEach(a => {
          const h = a.getAttribute("href")||"";
          const t = (a.textContent||"").trim().toLowerCase();
          if(h.startsWith("http") && !h.includes("google.com") && !h.includes("google.co") && !h.includes("goo.gl") && !h.includes("googleapis.com") && (t.includes(".com") || t.includes(".net") || t.includes(".org") || t.includes(".io") || t.includes("website")) && !website){
            website = h;
          }
        });
      }

      // Collect social/profile links from detail panel
      document.querySelectorAll('a[href]').forEach(a => {
        const h = a.getAttribute("href")||"";
        if(h.startsWith("http") && isSocialUrl(h) && !isGenericBookingLink(h) && !socialLinks.includes(h)){
          socialLinks.push(h);
        }
      });

      // Check for "Add website" (confirms no website)
      let noSiteConfirmed = false;
      document.querySelectorAll('.Io6YTe').forEach(el => {
        if(el.textContent.trim().toLowerCase()==="add website") noSiteConfirmed=true;
      });
      if(noSiteConfirmed) website = "";
    }

    // If "website" is actually a social link, move it
    if(website && isGenericBookingLink(website)){ website=''; }
    if(website && isSocialUrl(website)){ if(!socialLinks.includes(website)) socialLinks.push(website); website=''; }
    const {has_website, social_only} = classifyWebPresence(website, socialLinks);
    const status = getStatus(has_website, social_only, reviews);
    results.push({name, phone, website, rating, reviews, address, category, mapsUrl: el.href||"", has_website, social_only, socialLinks, status});

    // Progress update
    try{ chrome.runtime.sendMessage({action:"progress", current:i+1, total, name}); }catch(e){}

    // Go back to list
    const backBtn = document.querySelector('button[aria-label="Back"]');
    if(backBtn){ backBtn.click(); await sleep(800); }
    else { document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',keyCode:27,bubbles:true})); await sleep(800); }
  }
  return results;
}

/**
 * QUICK SCRAPE: Sidebar only, works for both layouts but only gets full data on expanded layout
 */
function quickScrape(){
  const layout = detectLayout();
  if(layout === "expanded") return scrapeExpanded();
  
  // Compact layout - sidebar only (limited data)
  const results=[], seen=new Set();
  document.querySelectorAll('a.hfpxzc').forEach(el => {
    const name = (el.getAttribute("aria-label")||"").trim();
    if(!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    const c = el.closest("div.Nv2PK") || el.parentElement?.parentElement;
    let rating=0, reviews=0;
    if(c){
      const starEl = c.querySelector('span[role="img"]');
      if(starEl){
        const label = starEl.getAttribute("aria-label")||"";
        const rm = label.match(/([\d.]+)\s*star/i); if(rm) rating=parseFloat(rm[1]);
        const revm = label.match(/([\d,]+)\s*review/i); if(revm) reviews=parseInt(revm[1].replace(",",""),10);
      }
    }
    results.push({name, phone:"", website:"", rating, reviews, address:"", category:"", mapsUrl:el.href||"", has_website:false, social_only:false, socialLinks:[], status:"NEEDS DEEP SCRAPE"});
  });
  return results;
}

/**
 * DEEP SCRAPE: Smart — uses sidebar for expanded layout, clicks for compact layout
 */
async function deepScrapeAll(maxScrolls){
  // First scroll to load more
  const feed = document.querySelector('div[role="feed"]') || document.querySelector(".m6QErb.DxyBCb");
  if(feed){
    let n=0, ph=feed.scrollHeight;
    while(n < (maxScrolls||5)){
      feed.scrollTop = feed.scrollHeight; await sleep(1500);
      if(feed.scrollHeight === ph){ await sleep(800); if(feed.scrollHeight === ph) break; }
      ph = feed.scrollHeight; n++;
    }
    feed.scrollTop = 0; await sleep(500);
  }

  const layout = detectLayout();
  
  if(layout === "expanded"){
    // For expanded layout, sidebar already has all the data
    return scrapeExpanded();
  } else {
    // For compact layout, need to click into each listing
    return scrapeCompact(0); // already scrolled above
  }
}

// Message handler
chrome.runtime.onMessage.addListener((req, sender, res) => {
  if(req.action === "scrape"){
    const layout = detectLayout();
    const data = quickScrape();
    res({success:true, data, mode:"quick", layout});
  }
  else if(req.action === "scrapeWithScroll"){
    deepScrapeAll(req.maxScrolls||5).then(data => {
      res({success:true, data, mode:"deep", layout: detectLayout()});
    });
    return true;
  }
  else if(req.action === "ping"){
    res({success:true, layout: detectLayout()});
  }
});
})();

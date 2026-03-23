let allLeads=[],dispLeads=[],selected=new Set(),filter="all",searchQuery="";

document.addEventListener("DOMContentLoaded",async()=>{
  const tab=await getTab();
  if(!tab?.url?.includes("google.com/maps")){
    document.getElementById("warning").style.display="block";
    document.getElementById("controls").style.display="none";
  }
  chrome.storage.local.get(["lpLeads","lpQuery"],(d)=>{
    if(d.lpLeads?.length){allLeads=d.lpLeads;searchQuery=d.lpQuery||"";render();}
  });
  document.getElementById("scrapeBtn").addEventListener("click",()=>scrape(false));
  document.getElementById("deepBtn").addEventListener("click",()=>scrape(true));
  document.getElementById("exportBtn").addEventListener("click",exportCSV);
  document.getElementById("copyBtn").addEventListener("click",copyLeads);
  document.getElementById("clearBtn").addEventListener("click",clearAll);
  chrome.runtime.onMessage.addListener((msg)=>{ if(msg.action==="progress"){ const btn=document.getElementById("deepBtn"); btn.innerHTML='<span class="spinner"></span> '+(msg.current)+'/'+msg.total; } });
  document.querySelectorAll(".fbtn").forEach(b=>b.addEventListener("click",()=>{
    filter=b.dataset.f;
    document.querySelectorAll(".fbtn").forEach(x=>x.className="fbtn");
    b.className="fbtn "+(filter==="no-website"?"act-r":filter==="hot"?"act-g":filter==="social-only"?"act-o":"active");
    render();
  }));
});

function extractQuery(url){
  if(!url)return "";
  try{
    // /maps/search/roofers+in+las+vegas/
    const m=url.match(/\/maps\/search\/([^\/\?]+)/);
    if(m)return decodeURIComponent(m[1].replace(/\+/g," "));
    // ?q=roofers+in+las+vegas
    const u=new URL(url);
    const q=u.searchParams.get("q");
    if(q)return q;
  }catch(e){}
  return "";
}

async function scrape(deep){
  const btn=document.getElementById(deep?"deepBtn":"scrapeBtn");
  const other=document.getElementById(deep?"scrapeBtn":"deepBtn");
  btn.disabled=true;other.disabled=true;
  btn.innerHTML='<span class="spinner"></span> '+(deep?"Scrolling...":"Scraping...");
  try{
    const tab=await getTab();
    if(!tab){toast("No active tab");return;}
    searchQuery=extractQuery(tab.url)||searchQuery;
    try{await chrome.scripting.executeScript({target:{tabId:tab.id},files:["content.js"]});}catch(e){}
    const r=await chrome.tabs.sendMessage(tab.id,{action:deep?"scrapeWithScroll":"scrape",maxScrolls:8});
    if(r?.success&&r.data?.length){
      const exist=new Set(allLeads.map(l=>l.name.toLowerCase()));
      const nw=r.data.filter(l=>!exist.has(l.name.toLowerCase()));
      allLeads=[...allLeads,...nw];
      allLeads.sort((a,b)=>{const p=s=>s==="HOT LEAD"?4:s==="NO WEBSITE"?3:s==="SOCIAL ONLY"?2:1;const as=p(a.status),bs=p(b.status);return as!==bs?bs-as:(b.reviews||0)-(a.reviews||0);});
      chrome.storage.local.set({lpLeads:allLeads,lpQuery:searchQuery});
      render();
      toast("Found "+r.data.length+" businesses"+(nw.length<r.data.length?" ("+nw.length+" new)":""));
    }else toast("No results. Make sure listings are visible.");
  }catch(e){toast("Error: make sure you're on Google Maps results");}
  finally{btn.disabled=false;other.disabled=false;btn.textContent=deep?"Deep Scrape":"Scrape This Page";}
}

function clearAll(){
  allLeads=[];dispLeads=[];selected=new Set();filter="all";searchQuery="";
  chrome.storage.local.remove(["lpLeads","lpQuery"]);
  ["stats","filters","footer"].forEach(id=>document.getElementById(id).style.display="none");
  document.getElementById("list").style.display="none";
  document.getElementById("list").innerHTML="";
  document.getElementById("empty").style.display="block";
  document.querySelectorAll(".fbtn").forEach(b=>b.className="fbtn");
  document.querySelector('[data-f="all"]').className="fbtn active";
  toast("Cleared! Ready for a new search.");
}

function render(){
  dispLeads=allLeads.filter(l=>{
    if(filter==="no-website")return !l.has_website;
    if(filter==="social-only")return l.social_only && !l.has_website;
    if(filter==="hot")return l.status==="HOT LEAD";
    if(filter==="has-website")return l.has_website;return true;
  });
  document.getElementById("sTotal").textContent=allLeads.length;
  document.getElementById("sNoSite").textContent=allLeads.filter(l=>!l.has_website).length;
  document.getElementById("sHot").textContent=allLeads.filter(l=>l.status==="HOT LEAD").length;
  const has=allLeads.length>0;
  ["stats","filters","footer"].forEach(id=>document.getElementById(id).style.display=has?"flex":"none");
  document.getElementById("empty").style.display=has?"none":"block";
  document.getElementById("list").style.display=has?"flex":"none";
  const list=document.getElementById("list");list.innerHTML="";
  dispLeads.forEach((l,i)=>{
    const c=document.createElement("div");
    c.className="card "+(l.status==="HOT LEAD"?"hot":l.status==="NO WEBSITE"?"nosite":l.status==="SOCIAL ONLY"?"socialonly":"");
    if(selected.has(i))c.classList.add("sel");
    const tag=l.status==="HOT LEAD"?'<span class="tag tag-o">HOT LEAD</span>':l.status==="SOCIAL ONLY"?'<span class="tag tag-y">SOCIAL ONLY</span>':l.status==="NO WEBSITE"?'<span class="tag tag-r">NO WEBSITE</span>':'<span class="tag tag-g">Has Site</span>';
    const ph=l.phone?'<span class="cph">'+l.phone+'</span>':'<span style="color:#999">No phone</span>';
    const ws=l.website?'<a href="'+l.website+'" target="_blank" class="cws">'+l.website.replace(/^https?:\/\/(www\.)?/,"").replace(/\/$/,"")+'</a>':'<span style="color:var(--r);font-weight:500;font-size:11px">No website</span>';
    const stars=l.rating?"\u2605".repeat(Math.round(l.rating))+" "+l.rating:"";
    // Show social/profile links if present
    let socialHtml='';
    if(l.socialLinks&&l.socialLinks.length){
      const labels=l.socialLinks.map(u=>{try{const h=new URL(u).hostname.replace(/^www\./,'').split('.')[0];return '<a href="'+u+'" target="_blank" class="csoc">'+h.charAt(0).toUpperCase()+h.slice(1)+'</a>';}catch(e){return '';}});
      socialHtml='<div class="cmeta csocrow">'+labels.join(' ')+'</div>';
    }
    c.innerHTML='<div class="cname"><span>'+l.name+'</span>'+tag+'</div><div class="cmeta">'+ph+" "+ws+(stars?' <span class="stars">'+stars+'</span>':"")+(l.reviews?' <span>('+l.reviews+' reviews)</span>':"")+'</div>'+socialHtml;
    c.addEventListener("click",e=>{if(e.target.tagName==="A")return;selected.has(i)?selected.delete(i):selected.add(i);c.classList.toggle("sel");updFooter();});
    list.appendChild(c);
  });
  updFooter();
}

function updFooter(){document.getElementById("finfo").textContent=selected.size?selected.size+" selected":dispLeads.length+" leads";}

function exportCSV(){
  const leads=selected.size?[...selected].map(i=>dispLeads[i]):dispLeads;
  if(!leads.length){toast("No leads");return;}
  const h=["Business Name","Phone","Website","Social Profiles","Rating","Reviews","Status","Address","Category","Google Maps URL"];
  const rows=[h.join(",")];
  leads.forEach(l=>rows.push(['"'+(l.name||"").replace(/"/g,'""')+'"','"'+(l.phone||"")+'"','"'+(l.website||"")+'"','"'+((l.socialLinks||[]).join(" | "))+'"',l.rating||0,l.reviews||0,'"'+(l.status||"")+'"','"'+(l.address||"").replace(/"/g,'""')+'"','"'+(l.category||"").replace(/"/g,'""')+'"','"'+(l.mapsUrl||"")+'"'].join(",")));
  const blob=new Blob([rows.join("\n")],{type:"text/csv"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;
  // === FILENAME FROM SEARCH QUERY ===
  let fn="leads_"+new Date().toISOString().slice(0,10)+".csv";
  if(searchQuery){
    const clean=searchQuery.toLowerCase().replace(/[^a-z0-9\s]/g,"").trim().replace(/\s+/g,"_");
    fn="prospects_"+clean+"_"+new Date().toISOString().slice(0,10)+".csv";
  }
  a.download=fn;a.click();URL.revokeObjectURL(url);
  toast("Exported "+leads.length+" leads \u2192 "+fn);
}

function copyLeads(){
  const leads=selected.size?[...selected].map(i=>dispLeads[i]):dispLeads;
  if(!leads.length){toast("No leads");return;}
  const t=leads.map(l=>l.name+"\t"+(l.phone||"N/A")+"\t"+(l.website||"No website")+"\t"+((l.socialLinks||[]).join(", ")||"None")+"\t"+(l.rating||"N/A")+"\t"+(l.reviews||0)+" reviews\t"+l.status).join("\n");
  navigator.clipboard.writeText(t).then(()=>toast("Copied "+leads.length+" leads"));
}

async function getTab(){const[t]=await chrome.tabs.query({active:true,currentWindow:true});return t;}
function toast(m){const t=document.getElementById("toast");t.textContent=m;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2500);}

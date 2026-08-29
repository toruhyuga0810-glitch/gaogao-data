/* OS6：Farm control — 画面共通（setup.html / record.html が読む）v1 2026-08-30
   ・設定（OS9と同じスプレッドシート・同じWebApp）
   ・読み＝gviz CSV／書き＝WebApp POST（管理者トークン）／通信が無い時は localStorage に溜めて「未送信N件」（黙った失敗の禁止）
   ・ページ側は loadAll() を定義しておくと、再送成功後に呼び直される */
const CONFIG = {
  SHEET_ID: "1hyNpkwXwF5JQE3pLY3DFhGGEX5228tQMbnBsyar7Ylg",
  WEBAPP_URL: "https://script.google.com/macros/s/AKfycbygruSomnxo__KoY3BxEbwOrZEcrPVggI1tqOOA6btrJRqfo8mfvUbpT2RX8DZ8_j3e/exec",
  TAB_FIELD: "圃場", TAB_HOUSE: "ハウス区画", TAB_BED: "畝・作付け", TAB_RECORD: "育成記録", TAB_TASK: "作業予定", TAB_PRICE: "圃場別価格表",
  DEFAULT_CENTER: [36.08, 140.20], DEFAULT_ZOOM: 13,   // 土浦市（緯度経度未設定の圃場の初期表示）
  STATUS: ["順調","注意","害虫","遅延","未入力","休耕"], FORMS: ["露地","ハウス","遮光"], OPS: ["主力","スポット","休止"],
  // 育成記録の選択肢（スプレッドシートのプルダウンと同じ並び・setupFarmTabs の rule と一致させる）
  LEAF: ["薄い","やや薄い","標準","やや濃い","濃い"], STEM: ["細い","やや細い","標準","やや太い","太い"],
  SOIL: ["乾燥","やや乾燥","適正","やや湿り","湿りすぎ"], PEST: ["なし","少量","中程度","多い"],
  PEST_KIND: ["アブラムシ","ハダニ","コナジラミ","アザミウマ","ヨトウ","うどんこ病","立枯れ","その他"],
  GSI_SEARCH: "https://msearch.gsi.go.jp/address-search/AddressSearch?q=",
  GSI_REVERSE: "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat={lat}&lon={lng}",
  GSI_MUNI: "https://maps.gsi.go.jp/js/muni.js",
};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad2 = n => String(n).padStart(2,"0");
const nowStr = () => { const d=new Date(); return `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
function say(t, cls){ const m=$("msg"); if(m) m.innerHTML = t ? `<div class="msg ${cls||"ok"}">${esc(t)}</div>` : ""; }

// ───────── gviz 読み（CSV）─────────
function parseCSV(text){
  const rows=[]; let row=[], cur="", q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else if(c==='"') q=true; else if(c===","){row.push(cur);cur="";} else if(c==="\n"){row.push(cur);rows.push(row);row=[];cur="";} else if(c!=="\r") cur+=c; }
  if(cur!==""||row.length){row.push(cur);rows.push(row);} return rows;
}
async function readTab(tab){
  const url=`https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const r=await fetch(url,{cache:"no-store"}); if(!r.ok) throw new Error(`${tab} を読めません（HTTP ${r.status}）`);
  const rows=parseCSV(await r.text()); if(!rows.length) return {head:[],rows:[]};
  const head=rows[0].map(h=>h.trim()); const out=rows.slice(1).filter(r=>r.some(v=>v&&v.trim())).map(r=>{const o={}; head.forEach((h,i)=>o[h]=(r[i]||"").trim()); return o;});
  return {head, rows: out};
}
// 列名は先頭一致で引く（「面積m2（自動）」も「面積」で当たる）
const col = (o, prefix) => { if(!o) return ""; const k=Object.keys(o).find(k=>k.startsWith(prefix)); return k? o[k] : ""; };
const fid = f => col(f,"圃場ID"); const hid = h => col(h,"区画ID"); const bid = b => col(b,"畝ID");

// ───────── 書き（WebApp POST・トークン・未送信キュー）─────────
const hasToken = () => !!localStorage.getItem("gg_os6_token");
function token(){ let t=localStorage.getItem("gg_os6_token"); if(!t){ t=prompt("管理者パスワード（OS9の承認画面と同じ）を入力"); if(t) localStorage.setItem("gg_os6_token",t); } return t||""; }
function queue(){ try{ return JSON.parse(localStorage.getItem("gg_os6_queue")||"[]"); }catch(e){ return []; } }
function setQueue(q){ localStorage.setItem("gg_os6_queue", JSON.stringify(q)); renderBadge(); }
function renderBadge(){ const n=queue().length; const b=$("badge"); if(!b) return; b.className="badge"+(n?" q":""); b.textContent = n? `未送信 ${n}件（通信が戻ったら「再送」）` : "同期OK"; if(n && !$("btnResend")){ const bt=document.createElement("button"); bt.id="btnResend"; bt.textContent="再送"; bt.onclick=flush; b.after(bt);} if(!n && $("btnResend")) $("btnResend").remove(); }
async function post(payload, {queueOnFail=true}={}){
  payload.token = token();
  try{
    const r=await fetch(CONFIG.WEBAPP_URL,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload)});
    const j=await r.json();
    if(!j.ok){
      if(j.error==="unauthorized"){ localStorage.removeItem("gg_os6_token"); throw new Error("パスワードが違います（もう一度保存すると再入力できます）"); }
      if(/unknown action: os6/.test(j.error||"")) throw new Error("Apps Script側にOS6の受付口がまだありません（「OS6 Farm API.gs」の貼付と doPost の1行追加・新バージョンのデプロイが必要）");
      throw new Error(j.error||"保存に失敗");
    }
    return j;
  }catch(e){
    if(queueOnFail && (e.name==="TypeError" || /Failed to fetch|NetworkError/.test(String(e)))){ const q=queue(); q.push({t:Date.now(),payload}); setQueue(q); say(`通信できないため手元に保存しました（未送信 ${q.length}件）。電波が戻ったら「再送」を押してください`, "err"); return {ok:false, queued:true}; }
    throw e;
  }
}
async function flush(){ const q=queue(); if(!q.length) return; let left=[]; for(const it of q){ try{ const r=await post(it.payload,{queueOnFail:false}); if(!r.ok) left.push(it);}catch(e){ left.push(it);} } setQueue(left); say(left.length? `${left.length}件がまだ送れません`: "未送信分をすべて送りました","ok"); if(!left.length && typeof loadAll==="function") await loadAll(); }
window.addEventListener("online", ()=>{ if(queue().length) flush(); });

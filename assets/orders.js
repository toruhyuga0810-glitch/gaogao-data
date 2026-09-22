/* GAOGAO 注文データ共通モジュール（確認・承認・実績ページで共有） */
const CONFIG = {
  SHEET_ID: "1hyNpkwXwF5JQE3pLY3DFhGGEX5228tQMbnBsyar7Ylg",
  ORDER_SHEET: "注文",
  PRICE_SHEET: "圃場別価格表",
  // Apps Scriptの /exec URL。空のうちは書き込み（承認・修正）はデモ表示のみ
  ORDER_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbygruSomnxo__KoY3BxEbwOrZEcrPVggI1tqOOA6btrJRqfo8mfvUbpT2RX8DZ8_j3e/exec",
  COMPANIES: ["QOF様", "SRBC様", "GAOGAO（テスト）"]
};

function parseCSV(text){
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=c; }
    else{ if(c==='"') q=true; else if(c===','){ row.push(cell); cell=''; }
      else if(c==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; }
      else if(c==='\r'){} else cell+=c; }
  }
  if(cell!==''||row.length){ row.push(cell); rows.push(row); }
  return rows;
}
function gvizURL(sheet){ return `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}&headers=1&t=${Date.now()}`; }
/* ---- シート読み出し（2026-09-22 重さ対策・hatchu.html のインライン版と手動同期） ----
   実測：GASの実行本体は1〜2秒で終わるが、結果を受け取るGoogleの中継（script.googleusercontent.com）が
   10〜90秒かかったり404を返す時間帯がある。それを3回×無期限で待っていたのが「重い」の正体。
   直し：①1回の待ちに上限（10秒・3回）②手元の写し（前回の良い結果＝localStorage／リポジトリの data/sheets/<名>.json）が
   あるタブは、GASが2.5秒で返らなければ写しを先に返して描き、GASが届いたら差し替える（stale-while-revalidate）。
   写しで描いた事実は rows.__stale に残し、ページは ggStaleBar() で注記を出す（§5.5＝黙って古いものを見せない）。
   写しの無いタブ（注文・納品書リンク）と、承認画面（window.GG_SHEET_LIVE_ONLY）は従来どおり最新だけを待つ。 */
const SHEET_SNAPSHOT_FILE={'推定供給（月間）':'supply','圃場別価格表':'prices','掲示板':'board','店舗実績':'stats'};   // scripts/snapshot_sheets.py と対
const SHEET_FETCH_TIMEOUT_MS=10000, SHEET_PATIENCE_MS=2500;
async function fetchWithTimeout(url,ms){ const ac=new AbortController(); const t=setTimeout(()=>ac.abort(),ms); try{ return await fetch(url,{cache:'no-store',signal:ac.signal}); } finally{ clearTimeout(t); } }
async function fetchSheetLive(sheet){
  // GASの読み出しAPI（上限つき・3回＝2026-09-17の一過性404への再試行を維持）。3回とも駄目なときだけ gviz へ落とす＝本物の障害（非公開のまま等）はここを抜けてエラーになる
  for(let i=0;i<3;i++){
    try{
      const r=await fetchWithTimeout(`${CONFIG.ORDER_WEBAPP_URL}?action=sheet&name=${encodeURIComponent(sheet)}&t=${Date.now()}`,SHEET_FETCH_TIMEOUT_MS);
      if(r.ok){ const j=await r.json(); if(j&&j.ok&&Array.isArray(j.rows)) return j.rows; }
    }catch(e){}
    if(i<2) await new Promise(r=>setTimeout(r,700));
  }
  const res=await fetchWithTimeout(gvizURL(sheet),SHEET_FETCH_TIMEOUT_MS);
  if(!res.ok) throw new Error('「'+sheet+'」の取得に失敗 ('+res.status+')');
  return parseCSV(await res.text());
}
function sheetLocalKey(sheet){ return 'gg_sheet_'+sheet; }
function sheetStoreLocal(sheet,rows){ try{ localStorage.setItem(sheetLocalKey(sheet),JSON.stringify({at:Date.now(),rows})); }catch(e){} }
async function sheetSnapshot(sheet){
  // 手元の写し：localStorage（この端末の前回の良い結果）と リポジトリの写し のうち新しい方
  let best=null;
  try{ const j=JSON.parse(localStorage.getItem(sheetLocalKey(sheet))||'null'); if(j&&Array.isArray(j.rows)&&j.rows.length) best={at:+j.at||0,rows:j.rows,source:'local'}; }catch(e){}
  const f=SHEET_SNAPSHOT_FILE[sheet];
  if(f){ try{ const r=await fetchWithTimeout('data/sheets/'+f+'.json?v='+Date.now(),6000);
    if(r.ok){ const j=await r.json(); const at=Date.parse(j.fetched)||0; if(Array.isArray(j.rows)&&j.rows.length&&(!best||at>best.at)) best={at,rows:j.rows,source:'repo'}; } }catch(e){} }
  return best;
}
async function fetchSheet(sheet){
  let liveRows=null;
  const live=fetchSheetLive(sheet).then(rows=>{ liveRows=rows; sheetStoreLocal(sheet,rows); return rows; });
  if(!(sheet in SHEET_SNAPSHOT_FILE) || window.GG_SHEET_LIVE_ONLY) return live;
  live.catch(()=>{});
  await Promise.race([live.catch(()=>null), new Promise(r=>setTimeout(r,SHEET_PATIENCE_MS))]);
  if(liveRows) return liveRows;
  const snap=await sheetSnapshot(sheet);
  if(liveRows) return liveRows;
  if(!snap) return live;   // 写しが無い＝従来どおり最新を待つ（失敗はそのまま投げる）
  const rows=snap.rows.slice();
  // 最新の到着はイベントでなく Promise で渡す＝GASが即座に失敗した（写しより先に決着した）ときも、後から購読する側が取りこぼさない
  const lv=live.then(fresh=>({rows:fresh,changed:JSON.stringify(fresh)!==JSON.stringify(snap.rows)})); lv.catch(()=>{});   // 購読前に失敗しても未処理エラーにしない
  rows.__stale={sheet,at:snap.at,source:snap.source,live:lv};
  return rows;
}
/* 写しで描いたときの注記バー（ページ上部に1本だけ）。最新が届き中身が違えば「最新に更新」を出す。
   window.ggApplyFresh(sheet,rows) をページが定義していればその場で差し替え、無ければ再読み込み。 */
function ggStaleBarShow_(s){
  const S=window.__ggStale||(window.__ggStale={pending:0,changed:false,failed:false,at:0,wired:false,settle:null});
  let bar=document.getElementById('gg-stale');
  if(!bar){ bar=document.createElement('div'); bar.id='gg-stale'; bar.setAttribute('role','status');
    bar.style.cssText='position:sticky;top:0;z-index:60;margin:0 0 10px;padding:8px 14px;border-radius:12px;font-size:13px;line-height:1.6;background:rgba(255,196,0,.14);color:inherit;border:1px solid rgba(255,196,0,.35);backdrop-filter:blur(8px)';
    const host=document.querySelector('.wrap')||document.querySelector('main')||document.body; host.insertBefore(bar,host.firstChild); }
  S.pending++; if(!S.at||(s.at&&s.at<S.at)) S.at=s.at||0;   // 複数タブが写しなら一番古い時点を出す
  const when=()=>S.at?new Date(S.at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
  bar.textContent='表示は '+when()+' 時点のデータです。最新を取得中…';
  if(S.wired) return; S.wired=true;
  S.settle=()=>{ if(S.pending>0) return; const bar=document.getElementById('gg-stale'); if(!bar) return;
    if(S.failed){ bar.textContent='最新の取得に失敗しました。表示は '+when()+' 時点のデータです。'; return; }
    if(!S.changed){ bar.remove(); return; }
    bar.textContent='最新のデータがあります。'; const b=document.createElement('button'); b.textContent='最新に更新'; b.className='btn'; b.style.cssText='margin-left:10px;padding:4px 12px;font-size:13px';
    b.onclick=()=>location.reload(); bar.appendChild(b); };
}
function ggStaleBar(rows){
  const s=rows&&rows.__stale; if(!s) return;
  ggStaleBarShow_(s);
  const S=window.__ggStale;
  s.live.then(d=>{ S.pending--;
    if(d.changed){ if(!(typeof window.ggApplyFresh==='function' && window.ggApplyFresh(s.sheet,d.rows)!==false)) S.changed=true; }
    S.settle(); }, ()=>{ S.pending--; S.failed=true; S.settle(); });
}
function num(v){ if(v==null||v===''||typeof v==='object'||typeof v==='function') return null; const n=parseFloat(String(v).normalize('NFKC').replace(/[,，\s¥円]/g,'')); return Number.isFinite(n)?n:null; }  // NaNも巨大値/Infinity(例:"1e999")も安全にnull
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function fmtDate(s){ const m=String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/); return m? `${m[1]}/${+m[2]}/${+m[3]}`:String(s==null?'':s); }  // 非文字列が来ても必ず文字列を返す
function ym(s){ const m=String(s).match(/(\d{4})[\/\-](\d{1,2})/); return m? `${m[1]}-${('0'+m[2]).slice(-2)}`:''; }

/* 注文シートを読み、明細（1行=1品目）の配列を返す。ヘッダー名で列を特定（並び替えに強い） */
async function loadOrderItems(){
  const rows = await fetchSheet(CONFIG.ORDER_SHEET);
  const hi = rows.findIndex(r=>r.some(c=>String(c).trim()==='注文番号'));
  if(hi<0) return [];
  const head = rows[hi].map(s=>String(s).trim());
  const col = n=>head.indexOf(n);
  const get=(r,n)=>{ const i=col(n); return i<0||r[i]==null?'':String(r[i]).trim(); };
  const items=[];
  for(let i=hi+1;i<rows.length;i++){
    const r=rows[i]; if(!get(r,'注文番号')) continue;
    items.push({
      id:get(r,'注文番号'), received:get(r,'受信日時'), company:get(r,'会社'), person:get(r,'担当者'),
      store:get(r,'店舗'),
      deliveryDate:get(r,'希望納品日'), call:get(r,'呼称'), jp:get(r,'日本名'),
      qty:Math.max(0,num(get(r,'数量(kg)'))||0), price:num(get(r,'単価(税抜)')),   // 数量は物理的に非負（シート直編集の負数から集計を守る）
      status:get(r,'ステータス')||'受付', note:get(r,'備考'), updated:get(r,'更新日時')
    });
  }
  return items;
}
/* 明細を注文番号でまとめる */
function groupOrders(items){
  const map=new Map();
  items.forEach(it=>{
    if(!map.has(it.id)) map.set(it.id,{id:it.id,received:it.received,company:it.company,person:it.person,store:it.store,
      deliveryDate:it.deliveryDate,note:it.note,status:it.status,updated:it.updated,items:[]});
    const o=map.get(it.id); o.items.push(it);
    if(it.status) o.status=it.status; // 同一注文は同ステータス
  });
  return [...map.values()].sort((a,b)=> (a.received<b.received?1:-1)); // 新しい順
}
/* Apps Scriptへ書き込み（承認・数量変更・単価設定など） */
async function postAction(payload){
  if(!CONFIG.ORDER_WEBAPP_URL) return {ok:false, error:'NO_WEBAPP'};
  let last='';
  for(let i=0;i<3;i++){                     // Apps Scriptは稀に空応答/瞬断があるためリトライ
    try{
      const res=await fetch(CONFIG.ORDER_WEBAPP_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
      const t=await res.text();
      if(t && t.trim()){ try{ return JSON.parse(t); }catch(e){ last='parse'; } }
      else last='empty';
    }catch(e){ last=(e&&e.message)||'fetch'; }
    if(i<2) await new Promise(r=>setTimeout(r,700));
  }
  return {ok:false, error:'TRANSIENT', detail:last};   // 3回とも失敗＝一時的な通信障害（誤ってokにしない）
}
function toast(msg){ let t=document.querySelector('.toast'); if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t);} t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600); }

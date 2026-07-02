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
function gvizURL(sheet){ return `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}&t=${Date.now()}`; }
async function fetchSheet(sheet){
  const res=await fetch(gvizURL(sheet),{cache:'no-store'});
  if(!res.ok) throw new Error('「'+sheet+'」の取得に失敗 ('+res.status+')');
  return parseCSV(await res.text());
}
function num(v){ if(v==null||v==='') return null; const n=parseFloat(String(v).replace(/[,，\s¥円]/g,'')); return isNaN(n)?null:n; }
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function fmtDate(s){ const m=String(s).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/); return m? `${m[1]}/${+m[2]}/${+m[3]}`:(s||''); }
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
      deliveryDate:get(r,'希望納品日'), call:get(r,'呼称'), jp:get(r,'日本名'),
      qty:num(get(r,'数量(kg)'))||0, price:num(get(r,'単価(税抜)')),
      status:get(r,'ステータス')||'受付', note:get(r,'備考'), updated:get(r,'更新日時')
    });
  }
  return items;
}
/* 明細を注文番号でまとめる */
function groupOrders(items){
  const map=new Map();
  items.forEach(it=>{
    if(!map.has(it.id)) map.set(it.id,{id:it.id,received:it.received,company:it.company,person:it.person,
      deliveryDate:it.deliveryDate,note:it.note,status:it.status,updated:it.updated,items:[]});
    const o=map.get(it.id); o.items.push(it);
    if(it.status) o.status=it.status; // 同一注文は同ステータス
  });
  return [...map.values()].sort((a,b)=> (a.received<b.received?1:-1)); // 新しい順
}
/* Apps Scriptへ書き込み（承認・数量変更・単価設定など） */
async function postAction(payload){
  if(!CONFIG.ORDER_WEBAPP_URL) return {ok:false, error:'NO_WEBAPP'};
  const res=await fetch(CONFIG.ORDER_WEBAPP_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(payload)});
  return res.json().catch(()=>({ok:true}));
}
function toast(msg){ let t=document.querySelector('.toast'); if(!t){t=document.createElement('div');t.className='toast';document.body.appendChild(t);} t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2600); }

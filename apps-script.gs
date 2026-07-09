/**
 * GAOGAO 発注・受付管理 Apps Script（管理機能対応版）
 * ============================================================
 * HPのカートからの注文を「注文」タブに記録し、確認・承認・実績ページと連携します。
 * APIキー不要・無料。
 *
 * ■ 設置手順
 *  1. 注文を記録するスプレッドシート（供給シートでOK）を開く
 *  2. 拡張機能 → Apps Script
 *  3. このコードを全部貼り付け、下の NOTIFY_EMAIL を自分の通知先に変更
 *  4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *       実行ユーザー：自分／アクセス：全員  → デプロイ → 権限を承認
 *  5. 表示された /exec URL を、各HTML（index.html / admin.html / order-confirm.html）の
 *     CONFIG.ORDER_WEBAPP_URL に貼る
 *
 * 列：注文番号 / 受信日時 / 会社 / 担当者 / 希望納品日 / 呼称 / 日本名 / 数量(kg) / 単価(税抜) / ステータス / 備考 / 更新日時
 */

const NOTIFY_EMAIL = 'toruhyuga@thaisupermarket99.com';   // 注文通知メールの宛先（GAOGAO事業用）
const ADMIN_TOKEN  = 'gaogao2026';                // ★承認ページのパスワード（好きな文字列に変更してください）
const ORDER_SHEET   = '注文';
const HEADERS = ['注文番号','受信日時','会社','担当者','希望納品日','呼称','日本名','数量(kg)','単価(税抜)','ステータス','備考','更新日時'];

// ▼ Discord通知（受注をDiscordへ。漏れ防止）。チャンネル設定→連携→Webhook のURLを貼る。空なら通知なし
const DISCORD_WEBHOOK_URL = '';
// ▼ 承認後「納品可能数」メールの宛先（会社名 → 送信先メール配列）
const COMPANY_EMAILS = {
  'QOF様':  ['y_murakami@qof.co.jp','b_sitalaphinunt@qof.co.jp','s_watanabe@qof.co.jp'],
  'SRBC様': ['y_onoue@spiceroad.co.jp','m_matsumoto@spiceroad.co.jp'],
  'GAOGAO（テスト）': ['toruhyuga0810@gmail.com']
};
// ▼ 掲示板（Discord「生育情報」チャンネル取り込み）。BotトークンとチャンネルIDを設定。空なら取り込まない
const BOARD_SHEET       = '掲示板';
const DISCORD_BOT_TOKEN = '';
const BOARD_CHANNEL_ID  = '';

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ORDER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ORDER_SHEET);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}
function colIndex_(sh, name) { return HEADERS.indexOf(name) + 1; } // 1-based
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
// 日付を「7月17日(金)」形式に（Date/文字列どちらでも受ける）
function fmtJpDate_(v) {
  let d = null;
  if (v instanceof Date) d = v;
  else if (v) {
    const m = String(v).match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) d = new Date(+m[1], +m[2]-1, +m[3]);
  }
  if (!d || isNaN(d.getTime())) return '';
  const w = '日月火水木金土'.charAt(d.getDay());
  return (d.getMonth()+1) + '月' + d.getDate() + '日(' + w + ')';
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'order';
    // パスワード確認用（承認ページのログイン）
    if (action === 'auth') return json_({ ok: data.token === ADMIN_TOKEN });
    // 承認系の操作（単価設定・承認/納品済み・供給マスタ編集）は管理者トークン必須
    const needToken = (action === 'setPrice') || (action === 'supplyUpdate') || (action === 'supplyAdd') || (action === 'priceUpdate') || (action === 'farmAdd') ||
                      (action === 'setStatus' && (data.status === '承認済み' || data.status === '納品済み'));
    if (needToken && data.token !== ADMIN_TOKEN) return json_({ ok:false, error:'unauthorized' });
    const sh = sheet_();
    if (action === 'supplyUpdate') return json_(supplyUpdate_(data));  // 承認画面から供給シートを直接編集
    if (action === 'supplyAdd')    return json_(supplyAdd_(data));     // 承認画面から品目を追加
    if (action === 'priceUpdate')  return json_(priceUpdate_(data));   // 承認画面から圃場別価格を編集
    if (action === 'farmAdd')      return json_(priceAddFarm_(data));  // 承認画面から圃場を追加
    if (action === 'boardSync')  return json_(boardSync_(data));   // GitHub Actionsから掲示板投稿を受け取る
    if (action === 'order')      return json_(recordOrder_(sh, data));
    if (action === 'setStatus')  return json_(setStatus_(sh, data));
    if (action === 'updateItem') return json_(updateItem_(sh, data));
    if (action === 'setPrice')   return json_(setPrice_(sh, data));
    return json_({ ok:false, error:'unknown action: ' + action });
  } catch (err) {
    return json_({ ok:false, error:String(err) });
  }
}

// 新規注文を記録（カートからの送信）
function recordOrder_(sh, data) {
  const now = new Date();
  const id  = 'ORD-' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
  const items = data.items || [];
  items.forEach(function(it){
    sh.appendRow([id, now, data.company||'', data.person||'', data.deliveryDate||'',
                  it.call||'', it.jp||'', it.qty||'', '', '受付', data.note||'', now]);
  });
  const lines = items.map(function(it){ return '・'+it.call+'（'+it.jp+'）: '+it.qty+' kg'; }).join('\n');
  const summary = '注文番号: '+id+'\n会社: '+(data.company||'')+'\n担当: '+(data.person||'')+
                  '\n希望納品日: '+(data.deliveryDate||'未定')+'\n\n'+lines+'\n\n備考: '+(data.note||'(なし)');
  // GAOGAOへメール通知
  MailApp.sendEmail(NOTIFY_EMAIL, '【GAOGAO注文】'+(data.company||'')+' '+id, '新しい注文が届きました。\n\n'+summary);
  // Discordへ通知（漏れ防止）
  if (DISCORD_WEBHOOK_URL) {
    try {
      UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, { method:'post', contentType:'application/json', muteHttpExceptions:true,
        payload: JSON.stringify({ content: '🛒 **新しい発注** ('+id+')\n'+summary }) });
    } catch (e) {}
  }
  return { ok:true, id:id };
}

// 注文全体のステータス変更（受付/承認済み/納品済み/キャンセル）
function setStatus_(sh, data) {
  const values = sh.getDataRange().getValues();
  const cId=colIndex_(sh,'注文番号')-1, cStatus=colIndex_(sh,'ステータス')-1, cUpd=colIndex_(sh,'更新日時')-1;
  const cCo=colIndex_(sh,'会社')-1, cPe=colIndex_(sh,'担当者')-1, cDl=colIndex_(sh,'希望納品日')-1,
        cCall=colIndex_(sh,'呼称')-1, cJp=colIndex_(sh,'日本名')-1, cQty=colIndex_(sh,'数量(kg)')-1, cPr=colIndex_(sh,'単価(税抜)')-1;
  let n=0, company='', person='', deliveryDate='', lines=[];
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][cId]) === String(data.id)) {
      sh.getRange(r+1, cStatus+1).setValue(data.status);
      sh.getRange(r+1, cUpd+1).setValue(new Date());
      company=values[r][cCo]; person=values[r][cPe]; deliveryDate=values[r][cDl];
      const pr=values[r][cPr];
      lines.push('・'+values[r][cCall]+'（'+values[r][cJp]+'）　'+values[r][cQty]+' kg'+((pr!==''&&pr!=null)?'　単価 '+pr+'円（税抜）':''));
      n++;
    }
  }
  // 承認時：納品可能数を顧客へ自動送信
  if (data.status === '承認済み') {
    const to = (COMPANY_EMAILS[company] || []).join(',');
    if (to) {
      const dj = fmtJpDate_(deliveryDate);   // 「7月17日(金)」形式
      // 件名は顧客の発注メール（【発注】会社名　◯月◯日(◯)着）に Re: を付けてスレッドがまとまりやすく
      const subject = 'Re: 【発注】' + company + (dj ? '　' + dj + '着' : '');
      const body = (person||'')+'様\n\nいつもお世話になっております。GAOGAOです。\n'+
        'ご注文（'+data.id+'）について、下記の内容で出荷可能です。\n希望納品日：'+(dj||'未定')+'\n\n'+
        lines.join('\n')+'\n\nご確認のほど、よろしくお願いいたします。\n（ご不明点はこのメールにご返信ください）';
      MailApp.sendEmail(to, subject, body);
    }
  }
  return { ok:true, updated:n };
}

// 明細の数量変更（qty<=0 で行削除＝キャンセル）
function updateItem_(sh, data) {
  const values = sh.getDataRange().getValues();
  const cId = colIndex_(sh,'注文番号')-1, cCall = colIndex_(sh,'呼称')-1,
        cQty = colIndex_(sh,'数量(kg)')-1, cUpd = colIndex_(sh,'更新日時')-1;
  for (let r = values.length-1; r >= 1; r--) {
    if (String(values[r][cId])===String(data.id) && String(values[r][cCall])===String(data.call)) {
      if (Number(data.qty) <= 0) { sh.deleteRow(r+1); }
      else { sh.getRange(r+1, cQty+1).setValue(Number(data.qty)); sh.getRange(r+1, cUpd+1).setValue(new Date()); }
      return { ok:true };
    }
  }
  return { ok:false, error:'item not found' };
}

// 単価の設定（承認時にGAOGAOが入力）
function setPrice_(sh, data) {
  const values = sh.getDataRange().getValues();
  const cId = colIndex_(sh,'注文番号')-1, cCall = colIndex_(sh,'呼称')-1,
        cPrice = colIndex_(sh,'単価(税抜)')-1, cUpd = colIndex_(sh,'更新日時')-1;
  let n = 0;
  for (let r = 1; r < values.length; r++) {
    if (String(values[r][cId])===String(data.id) && (!data.call || String(values[r][cCall])===String(data.call))) {
      sh.getRange(r+1, cPrice+1).setValue(Number(data.price));
      sh.getRange(r+1, cUpd+1).setValue(new Date());
      n++;
    }
  }
  return { ok:true, updated:n };
}

function doGet() {
  return ContentService.createTextOutput('GAOGAO order endpoint is running.');
}

/**
 * 初回セットアップ：Apps Scriptエディタで一度だけ実行してください。
 * 「注文」タブを作成し、見出し・書式・列幅を整えます。
 * （上部の関数選択で setup を選び ▶ 実行 → 権限を承認）
 */
function setup() {
  const sh = sheet_(); // 無ければHEADERS付きで作成
  const hdr = sh.getRange(1, 1, 1, HEADERS.length);
  hdr.setValues([HEADERS]).setFontWeight('bold').setBackground('#2e7d4f').setFontColor('#ffffff').setHorizontalAlignment('center');
  sh.setFrozenRows(1);
  const widths = [150,150,90,90,110,120,120,90,100,100,170,150];
  HEADERS.forEach(function(h, i){ sh.setColumnWidth(i+1, widths[i] || 110); });
  // ステータス列に入力規則（プルダウン）
  const cStatus = colIndex_(sh, 'ステータス');
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(['受付','承認済み','納品済み','キャンセル'], true).build();
  sh.getRange(2, cStatus, 1000, 1).setDataValidation(rule);
  SpreadsheetApp.getActiveSpreadsheet().toast('「注文」タブを準備しました。', 'GAOGAO setup 完了', 6);
}

/* ========== 掲示板：Cloudflare Workerから受け取ってシートに書く ==========
 * DiscordはGoogleのIPを弾くため、Apps Scriptから直接読めない。
 * Cloudflare Workerが数分ごとにDiscordを読み、この /exec に action:'boardSync' でPOSTしてくる。
 */
function boardSync_(data) {
  if (data.token !== ADMIN_TOKEN) return { ok:false, error:'unauthorized' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(BOARD_SHEET);
  if (!sh) { sh = ss.insertSheet(BOARD_SHEET); sh.appendRow(['日時','分類','本文','投稿者','msgId']); sh.setFrozenRows(1); }
  const lastRow = sh.getLastRow();
  const seen = {};
  if (lastRow >= 2) {
    sh.getRange(2, 5, lastRow-1, 1).getValues().forEach(function(r){ seen[String(r[0])] = true; });
  }
  const cats = ['生育状況','生育遅延','天候','病害虫'];
  const msgs = (data.messages || []).slice().sort(function(a,b){ return a.id > b.id ? 1 : -1; });
  let added = 0;
  msgs.forEach(function(m){
    if (m.pinned || m.bot || m.webhook) return;   // お知らせ/Bot/Webhookは載せない
    if (!m.content) return;
    if (seen[String(m.id)]) return;               // 重複は載せない
    let cat = 'その他';
    cats.forEach(function(c){ if (String(m.content).indexOf(c) >= 0) cat = c; });
    const when = m.timestamp ? Utilities.formatDate(new Date(m.timestamp), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm') : '';
    sh.appendRow([when, cat, m.content, m.author || '', m.id]);
    seen[String(m.id)] = true; added++;
  });
  return { ok:true, added:added };
}

/* ===== 掲示板：スプシ直接入力のサポート ===== */
/**
 * 一度だけ実行：掲示板タブに入力支援を設定
 * ・分類＝リスト選択（生育状況/生育遅延/天候/病害虫/その他）
 * ・投稿者＝リスト選択（自由入力も可。下のリストは編集OK）
 * ・見出しの体裁・列幅・本文の折り返し
 */
function setupBoardInput() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(BOARD_SHEET);
  if (!sh) { sh = ss.insertSheet(BOARD_SHEET); sh.appendRow(['日時','分類','本文','投稿者','msgId']); }
  sh.getRange(1,1,1,5).setValues([['日時','分類','本文','投稿者','msgId']])
    .setFontWeight('bold').setBackground('#2e7d4f').setFontColor('#ffffff').setHorizontalAlignment('center');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1,130); sh.setColumnWidth(2,100); sh.setColumnWidth(3,420); sh.setColumnWidth(4,120); sh.setColumnWidth(5,160);
  // 分類：プルダウン
  const catRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['生育状況','生育遅延','天候','病害虫','その他'], true).setAllowInvalid(false).build();
  sh.getRange(2,2,999,1).setDataValidation(catRule);
  // 投稿者：プルダウン（リスト外の名前も入力可）
  const whoRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['日向 徹','Niu','Matsumoto','近藤崇穣'], true).setAllowInvalid(true).build();
  sh.getRange(2,4,999,1).setDataValidation(whoRule);
  // 本文は折り返し表示
  sh.getRange(2,3,999,1).setWrap(true);
  ss.toast('掲示板の入力支援（分類/投稿者リスト・日時自動）を設定しました。', 'GAOGAO', 6);
}

/** 掲示板タブで本文を入力すると、日時が空なら現在日時を自動記入（自動トリガー・設定不要） */
function onEdit(e) {
  try {
    const sh = e.range.getSheet();
    if (sh.getName() !== BOARD_SHEET) return;
    const first = e.range.getRow(), last = first + e.range.getNumRows() - 1;
    for (let r = Math.max(2, first); r <= last; r++) {
      const hasBody = String(sh.getRange(r, 3).getValue() || '') !== '';
      const dateCell = sh.getRange(r, 1);
      if (hasBody && !dateCell.getValue()) {
        dateCell.setValue(Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm'));
      }
    }
  } catch (err) {}
}

/** 旧方式（Apps Scriptから直接Discord取り込み）の10分毎トリガーが残っていたら削除。エディタで1回実行 */
function cleanupOldBoardTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'syncBoard') ScriptApp.deleteTrigger(t);
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('旧トリガーを削除しました。', 'GAOGAO', 5);
}

/* ===== 供給シート編集（承認画面の「供給・出荷マスタ」タブから） ===== */
const SUPPLY_SHEET_NAME = '推定供給（月間）';
function supplyUpdate_(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SUPPLY_SHEET_NAME);
  if (!sh) return { ok:false, error:'供給シートが見つかりません' };
  const values = sh.getDataRange().getValues();
  let hr = -1;
  for (let r = 0; r < values.length; r++) { if (String(values[r][0]).trim() === '呼称') { hr = r; break; } }
  if (hr < 0) return { ok:false, error:'見出し行が見つかりません' };
  let row = -1;
  for (let r = hr + 1; r < values.length; r++) {
    const c = String(values[r][0]).trim();
    if (!c) continue;   // 途中の空行では打ち切らない
    if (c === String(data.call).trim()) { row = r; break; }
  }
  if (row < 0) return { ok:false, error:'品目が見つかりません: ' + data.call };
  const R = row + 1;
  // 月別供給量（D〜O列＝1〜12月）。数字/◯/空欄
  if (data.months) {
    for (let m = 1; m <= 12; m++) {
      const key = String(m);
      if (!(key in data.months)) continue;
      let v = data.months[key]; v = (v == null) ? '' : String(v).trim();
      if (v === '') sh.getRange(R, 3 + m).setValue('');
      else if (v === '◯' || v === '○' || v === 'o' || v === 'O') sh.getRange(R, 3 + m).setValue('◯');
      else { const n = parseFloat(v); sh.getRange(R, 3 + m).setValue(isNaN(n) ? v : n); }
    }
  }
  // 納品開始日（P列）
  if (data.start !== undefined) sh.getRange(R, 16).setValue(data.start || '');
  // 可能収穫量（R列）
  if (data.next !== undefined) sh.getRange(R, 18).setValue(data.next || '');
  // 更新日（Q2）を自動更新
  try { if (String(values[1][15]).trim() === '更新日') sh.getRange(2, 17).setValue(new Date()); } catch (e) {}
  return { ok:true };
}

/** 品目の新規追加（承認画面の「供給・出荷マスタ」タブから） */
function supplyAdd_(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SUPPLY_SHEET_NAME);
  if (!sh) return { ok:false, error:'供給シートが見つかりません' };
  const call = String(data.call || '').trim();
  const jp = String(data.jp || '').trim();
  if (!call || !jp) return { ok:false, error:'呼称と日本名は必須です' };
  const values = sh.getDataRange().getValues();
  let hr = -1;
  for (let r = 0; r < values.length; r++) { if (String(values[r][0]).trim() === '呼称') { hr = r; break; } }
  if (hr < 0) return { ok:false, error:'見出し行が見つかりません' };
  let last = hr;
  for (let r = hr + 1; r < values.length; r++) {
    const c = String(values[r][0]).trim();
    const j = String(values[r][1] || '').trim();
    if (!c || !j) continue;   // 呼称と日本名が揃った行だけを品目とみなす（空行・メモ行は飛ばす）
    if (c === call) return { ok:false, error:'同じ呼称の品目が既にあります: ' + call };
    last = r;
  }
  sh.insertRowAfter(last + 1);
  const R = last + 2;
  sh.getRange(R, 1, 1, 3).setValues([[call, jp, String(data.th || '').trim()]]);
  if (data.start) sh.getRange(R, 16).setValue(data.start);
  if (data.next) sh.getRange(R, 18).setValue(data.next);
  try { if (String(values[1][15]).trim() === '更新日') sh.getRange(2, 17).setValue(new Date()); } catch (e) {}
  // 価格表シートにも品目行を自動追加（価格は空欄）
  try { priceAddRow_(call, jp, String(data.th || '').trim()); } catch (e) {}
  return { ok:true };
}

/* ===== 圃場別価格表の編集（承認画面から） =====
 * レイアウトは2種類に対応：
 *  ・新レイアウト（推奨）：行=品目・列=圃場のマトリクス。migratePriceSheet で移行できる
 *  ・旧レイアウト：圃場ごとのブロック型（従来）
 */
const PRICE_SHEET_NAME = '圃場別価格表';

// 旧レイアウト（ブロック型）の圃場見出し検出
function findPriceHeads_(values) {
  const heads = [];
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const t = String(row[c] || '');
      if (t.indexOf('圃場') >= 0 && t.indexOf('：') >= 0) {
        const m = t.match(/第(\d+)/);
        if (m) heads.push({ r: r, c: c, num: Number(m[1]) });
      }
    }
  }
  return heads;
}

// 新レイアウトの検出：同じ行に「呼称」と「第N圃場：…」が並んでいれば新レイアウト
function findPriceMatrix_(values) {
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    let cCall = -1, cJp = -1, cEn = -1, cTh = -1;
    const farms = [];
    for (let c = 0; c < row.length; c++) {
      const t = String(row[c] || '').trim();
      if (t === '呼称') cCall = c;
      else if (t === '日本名') cJp = c;
      else if (t === '英語名') cEn = c;
      else if (t === 'タイ語名') cTh = c;
      else if (t.indexOf('圃場') >= 0 && t.indexOf('：') >= 0) {
        const m = t.match(/第(\d+)/);
        if (m) farms.push({ c: c, num: Number(m[1]), name: t });
      }
    }
    if (cCall >= 0 && farms.length) {
      return { hr: r, cCall: cCall, cJp: (cJp >= 0 ? cJp : Math.max(cCall - 1, 0)), cEn: cEn, cTh: cTh, farms: farms };
    }
  }
  return null;
}

// 「更新日」ラベルの右隣セルに現在日時を書く（新旧レイアウト共通）
function touchPriceUpdated_(sh, values) {
  try {
    for (let r = 0; r < Math.min(3, values.length); r++) {
      const row = values[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (String(row[c] || '').trim() === '更新日') { sh.getRange(r + 1, c + 2).setValue(new Date()); return; }
      }
    }
  } catch (e) {}
}

/** 品目×圃場の卸値を更新。prices例: {"第1圃場":"1700","第2圃場":""} */
function priceUpdate_(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PRICE_SHEET_NAME);
  if (!sh) return { ok:false, error:'価格表シートが見つかりません' };
  const values = sh.getDataRange().getValues();
  const call = String(data.call || '').trim();
  if (!call) return { ok:false, error:'呼称が必要です' };
  const prices = data.prices || {};
  // --- 新レイアウト ---
  const mx = findPriceMatrix_(values);
  if (mx) {
    let row = -1;
    for (let r = mx.hr + 1; r < values.length; r++) {
      if (String((values[r] || [])[mx.cCall] || '').trim() === call) { row = r; break; }
    }
    if (row < 0) return { ok:false, error:'価格表にこの品目の行がありません: ' + call };
    let updated = 0;
    mx.farms.forEach(function(f) {
      const key = '第' + f.num + '圃場';
      if (!(key in prices)) return;
      let v = prices[key]; v = (v == null) ? '' : String(v).trim();
      const cell = sh.getRange(row + 1, f.c + 1);
      if (v === '') cell.setValue('');
      else { const n = parseFloat(v); cell.setValue(isNaN(n) ? v : n); }
      updated++;
    });
    touchPriceUpdated_(sh, values);
    return { ok:true, updated: updated };
  }
  // --- 旧レイアウト（ブロック型） ---
  const heads = findPriceHeads_(values);
  if (!heads.length) return { ok:false, error:'圃場見出しが見つかりません' };
  const bandRows = heads.map(function(h){return h.r;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort(function(a,b){return a-b;});
  let updated = 0;
  heads.forEach(function(h) {
    const key = '第' + h.num + '圃場';
    if (!(key in prices)) return;
    let v = prices[key]; v = (v == null) ? '' : String(v).trim();
    const bi = bandRows.indexOf(h.r);
    const end = (bi + 1 < bandRows.length) ? bandRows[bi + 1] : values.length;
    for (let r = h.r + 2; r < end; r++) {
      if (String((values[r] || [])[h.c + 1] || '').trim() === call) {
        const cell = sh.getRange(r + 1, h.c + 5);
        if (v === '') cell.setValue('');
        else { const n = parseFloat(v); cell.setValue(isNaN(n) ? v : n); }
        updated++;
        break;
      }
    }
  });
  touchPriceUpdated_(sh, values);
  if (updated === 0) return { ok:false, error:'価格表にこの品目の行がありません: ' + call };
  return { ok:true, updated: updated };
}

/** 圃場の新規追加。新レイアウトなら列を1本追加するだけ（品目は全行に自動適用） */
function priceAddFarm_(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PRICE_SHEET_NAME);
  if (!sh) return { ok:false, error:'価格表シートが見つかりません' };
  const num = parseInt(data.num, 10);
  if (!num || num < 1) return { ok:false, error:'圃場番号が正しくありません' };
  const loc = String(data.loc || '').trim();
  const values = sh.getDataRange().getValues();
  // --- 新レイアウト：最後の圃場列の右に1列追加 ---
  const mx = findPriceMatrix_(values);
  if (mx) {
    if (mx.farms.some(function(f){ return f.num === num; })) return { ok:false, error:'第' + num + '圃場は既にあります' };
    const lastF = mx.farms.reduce(function(a, b){ return a.c > b.c ? a : b; });
    sh.insertColumnAfter(lastF.c + 1);
    sh.getRange(mx.hr + 1, lastF.c + 2).setValue('第' + num + '圃場：' + loc).setFontWeight('bold');
    touchPriceUpdated_(sh, values);
    return { ok:true, farm:'第' + num + '圃場', mode:'column' };
  }
  // --- 旧レイアウト：一番下に新ブロックを作り、品目一覧を複製 ---
  const heads = findPriceHeads_(values);
  if (!heads.length) return { ok:false, error:'既存の圃場見出しが見つかりません' };
  if (heads.some(function(h){ return h.num === num; })) return { ok:false, error:'第' + num + '圃場は既にあります' };
  const sorted = heads.slice().sort(function(a,b){ return a.r - b.r || a.c - b.c; });
  const h0 = sorted[0];
  const bandRows = heads.map(function(h){return h.r;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort(function(a,b){return a-b;});
  const bi = bandRows.indexOf(h0.r);
  const end = (bi + 1 < bandRows.length) ? bandRows[bi + 1] : values.length;
  const items = [];
  for (let r = h0.r + 2; r < end; r++) {
    const row = values[r] || [];
    const call = String(row[h0.c + 1] || '').trim();
    if (!call || call === '呼称') continue;   // ブロック内の空行・見出し行は飛ばして最後まで拾う
    items.push([ String(row[h0.c] || ''), call, String(row[h0.c + 2] || ''), String(row[h0.c + 3] || ''), '' ]);
  }
  const hRow = values[h0.r + 1] || [];
  const hdr = [
    String(hRow[h0.c] || '日本名'), String(hRow[h0.c + 1] || '呼称'),
    String(hRow[h0.c + 2] || '英語名'), String(hRow[h0.c + 3] || 'タイ語名'),
    String(hRow[h0.c + 4] || '卸値（円/kg・税抜）')
  ];
  const start = sh.getLastRow() + 2;   // 1-based
  const col = h0.c + 1;                // 1-based
  sh.getRange(start, col).setValue('第' + num + '圃場：' + loc).setFontWeight('bold');
  sh.getRange(start + 1, col, 1, 5).setValues([hdr]).setFontWeight('bold');
  if (items.length) sh.getRange(start + 2, col, items.length, 5).setValues(items);
  touchPriceUpdated_(sh, values);
  return { ok:true, farm:'第' + num + '圃場', items: items.length };
}

/** 品目追加時に価格表へ行を追加（supplyAdd_ から自動で呼ばれる） */
function priceAddRow_(call, jp, th) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PRICE_SHEET_NAME);
  if (!sh) return;
  const values = sh.getDataRange().getValues();
  // --- 新レイアウト：一番下に1行追加するだけ ---
  const mx = findPriceMatrix_(values);
  if (mx) {
    let last = mx.hr, exists = false;
    for (let r = mx.hr + 1; r < values.length; r++) {
      const c0 = String((values[r] || [])[mx.cCall] || '').trim();
      if (!c0) continue;
      if (c0 === call) exists = true;
      last = r;
    }
    if (exists) return;
    sh.insertRowAfter(last + 1);
    const R = last + 2;
    sh.getRange(R, mx.cJp + 1).setValue(jp);
    sh.getRange(R, mx.cCall + 1).setValue(call);
    if (mx.cTh >= 0 && th) sh.getRange(R, mx.cTh + 1).setValue(th);
    return;
  }
  // --- 旧レイアウト：各ブロックへ行を追加（下のブロックから処理して行ズレを回避） ---
  const heads = findPriceHeads_(values);
  if (!heads.length) return;
  const bandRows = heads.map(function(h){return h.r;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort(function(a,b){return a-b;});
  for (let bi = bandRows.length - 1; bi >= 0; bi--) {
    const br = bandRows[bi];
    const bandHeads = heads.filter(function(h){return h.r===br;}).sort(function(a,b){return a.c-b.c;});
    const end = (bi + 1 < bandRows.length) ? bandRows[bi + 1] : values.length;
    const h0 = bandHeads[0];
    let last = br + 1, exists = false;
    for (let r = br + 2; r < end; r++) {
      const c0 = String((values[r] || [])[h0.c + 1] || '').trim();
      if (!c0) break;
      if (c0 === call) exists = true;
      last = r;
    }
    if (exists) continue;
    sh.insertRowAfter(last + 1);
    const R = last + 2;
    bandHeads.forEach(function(h) {
      sh.getRange(R, h.c + 1, 1, 4).setValues([[jp, call, '', th || '']]);
    });
  }
}

/**
 * 【一度だけ実行】圃場別価格表を「行=品目・列=圃場」の新レイアウトに作り替えます。
 * ・品目が増えても行がズレない構造になります
 * ・旧シートは「圃場別価格表（旧バックアップ）」という名前で残ります（自動では消しません）
 * 実行方法：エディタ上部の関数選択で migratePriceSheet を選んで ▶ 実行
 */
function migratePriceSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(PRICE_SHEET_NAME);
  if (!sh) throw new Error('「' + PRICE_SHEET_NAME + '」シートが見つかりません');
  const values = sh.getDataRange().getValues();
  if (findPriceMatrix_(values)) { ss.toast('すでに新レイアウトです。何もしていません。', 'GAOGAO', 8); return; }
  const heads = findPriceHeads_(values);
  if (!heads.length) throw new Error('圃場見出し（第◯圃場：…）が見つかりません');
  const bandRows = heads.map(function(h){return h.r;}).filter(function(v,i,a){return a.indexOf(v)===i;}).sort(function(a,b){return a-b;});
  const order = [];
  const master = {};
  const farmNames = {};
  heads.forEach(function(h) {
    farmNames[h.num] = String(values[h.r][h.c]).trim();
    const bi = bandRows.indexOf(h.r);
    const end = (bi + 1 < bandRows.length) ? bandRows[bi + 1] : values.length;
    for (let r = h.r + 2; r < end; r++) {
      const row = values[r] || [];
      const call = String(row[h.c + 1] || '').trim();
      if (!call || call === '呼称') continue;
      if (!master[call]) { master[call] = { jp:'', en:'', th:'', prices:{} }; order.push(call); }
      const m = master[call];
      if (!m.jp) m.jp = String(row[h.c] || '').trim();
      if (!m.en) m.en = String(row[h.c + 2] || '').trim();
      if (!m.th) m.th = String(row[h.c + 3] || '').trim();
      const p = row[h.c + 4];
      if (p !== '' && p != null) m.prices[h.num] = p;
    }
  });
  const nums = Object.keys(farmNames).map(Number).sort(function(a,b){return a-b;});
  // 新シートを組み立て
  const tmpName = PRICE_SHEET_NAME + '＿作成中';
  let ns = ss.getSheetByName(tmpName);
  if (ns) ss.deleteSheet(ns);
  ns = ss.insertSheet(tmpName);
  const header = ['日本名','呼称','英語名','タイ語名'].concat(nums.map(function(n){ return farmNames[n]; }));
  const grid = [header];
  order.forEach(function(c) {
    const m = master[c];
    grid.push([m.jp, c, m.en, m.th].concat(nums.map(function(n){ return (m.prices[n] != null) ? m.prices[n] : ''; })));
  });
  ns.getRange(1, 1).setValue('圃場別 卸価格（円/kg・税抜）※空欄＝取扱なし').setFontWeight('bold');
  ns.getRange(1, 6).setValue('更新日');
  ns.getRange(1, 7).setValue(new Date());
  ns.getRange(2, 1, grid.length, header.length).setValues(grid);
  ns.getRange(2, 1, 1, header.length).setFontWeight('bold').setBackground('#2e7d4f').setFontColor('#ffffff').setHorizontalAlignment('center');
  ns.setFrozenRows(2);
  ns.setFrozenColumns(2);
  ns.setColumnWidth(1, 160); ns.setColumnWidth(2, 160); ns.setColumnWidth(3, 140); ns.setColumnWidth(4, 130);
  for (let i = 0; i < nums.length; i++) ns.setColumnWidth(5 + i, 170);
  // 入れ替え：旧をバックアップ名に、新を正式名に
  let bak = PRICE_SHEET_NAME + '（旧バックアップ）';
  if (ss.getSheetByName(bak)) bak = bak + '_' + Utilities.formatDate(new Date(), 'Asia/Tokyo', 'MMddHHmm');
  sh.setName(bak);
  ns.setName(PRICE_SHEET_NAME);
  ss.toast('新レイアウトに移行しました（品目' + order.length + '件 × 圃場' + nums.length + '面）。旧シートは「' + bak + '」として残っています。', 'GAOGAO', 10);
}

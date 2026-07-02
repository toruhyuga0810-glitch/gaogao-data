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

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action || 'order';
    // パスワード確認用（承認ページのログイン）
    if (action === 'auth') return json_({ ok: data.token === ADMIN_TOKEN });
    // 承認系の操作（単価設定・承認済み/納品済みへの変更）は管理者トークン必須
    const needToken = (action === 'setPrice') ||
                      (action === 'setStatus' && (data.status === '承認済み' || data.status === '納品済み'));
    if (needToken && data.token !== ADMIN_TOKEN) return json_({ ok:false, error:'unauthorized' });
    const sh = sheet_();
    if (action === 'boardSync')  return json_(boardSync_(data));   // Cloudflare Workerから掲示板投稿を受け取る
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
  const lines = items.map(function(it){ return '・'+it.jp+'（'+it.call+'）: '+it.qty+' kg'; }).join('\n');
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
      lines.push('・'+values[r][cJp]+'（'+values[r][cCall]+'）　'+values[r][cQty]+' kg'+((pr!==''&&pr!=null)?'　単価 '+pr+'円（税抜）':''));
      n++;
    }
  }
  // 承認時：納品可能数を顧客へ自動送信
  if (data.status === '承認済み') {
    const to = (COMPANY_EMAILS[company] || []).join(',');
    if (to) {
      const body = (person||'')+'様\n\nいつもお世話になっております。GAOGAOです。\n'+
        'ご注文（'+data.id+'）について、下記の内容で出荷可能です。\n希望納品日：'+(deliveryDate||'未定')+'\n\n'+
        lines.join('\n')+'\n\nご確認のほど、よろしくお願いいたします。\n（ご不明点はこのメールにご返信ください）';
      MailApp.sendEmail(to, '【GAOGAO】ご注文 '+data.id+' 納品可能数のご連絡', body);
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

/** 旧方式（Apps Scriptから直接Discord取り込み）の10分毎トリガーが残っていたら削除。エディタで1回実行 */
function cleanupOldBoardTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'syncBoard') ScriptApp.deleteTrigger(t);
  });
  SpreadsheetApp.getActiveSpreadsheet().toast('旧トリガーを削除しました。', 'GAOGAO', 5);
}

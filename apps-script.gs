/**
 * GAOGAO 発注受け取り用 Apps Script
 * --------------------------------------------------
 * HPのカートから送られた注文を、スプレッドシートの「注文」タブに記録し、
 * 指定アドレスにメール通知します。APIキー不要・無料。
 *
 * ■ 設置手順（READMEにも記載）
 *  1. 注文を記録したいスプレッドシートを開く
 *  2. 拡張機能 → Apps Script を開く
 *  3. このコードを全部貼り付け、下のNOTIFY_EMAILを自分の通知先に変更
 *  4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *       次のユーザーとして実行：自分
 *       アクセスできるユーザー：全員
 *     → デプロイ → 出てくる「ウェブアプリURL（…/exec）」をコピー
 *  5. index.html の CONFIG.ORDER_WEBAPP_URL にそのURLを貼る
 */

const NOTIFY_EMAIL = 'toruhyuga0810@gmail.com';   // ← 注文通知メールの宛先
const ORDER_SHEET  = '注文';                       // 記録先タブ名（自動作成されます）

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(ORDER_SHEET);
    if (!sh) {
      sh = ss.insertSheet(ORDER_SHEET);
      sh.appendRow(['注文番号','受信日時','会社','担当者','希望納品日','呼称','日本名','数量(kg)','備考','ステータス']);
      sh.setFrozenRows(1);
    }
    const now = new Date();
    const id  = 'ORD-' + Utilities.formatDate(now, 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
    const items = data.items || [];
    items.forEach(function(it) {
      sh.appendRow([id, now, data.company || '', data.person || '', data.deliveryDate || '',
                    it.call || '', it.jp || '', it.qty || '', data.note || '', '受付']);
    });

    // メール通知
    const lines = items.map(function(it){ return '・' + it.jp + '（' + it.call + '）: ' + it.qty + ' kg'; }).join('\n');
    const body =
      '新しい注文が届きました。\n\n' +
      '注文番号: ' + id + '\n' +
      '会社: ' + (data.company || '') + '\n' +
      '担当: ' + (data.person || '') + '\n' +
      '希望納品日: ' + (data.deliveryDate || '未定') + '\n\n' +
      lines + '\n\n' +
      '備考: ' + (data.note || '(なし)') + '\n';
    MailApp.sendEmail(NOTIFY_EMAIL, '【GAOGAO注文】' + (data.company || '') + ' ' + id, body);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, id: id }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// 動作確認用（ブラウザでURLを開いたとき）
function doGet() {
  return ContentService.createTextOutput('GAOGAO order endpoint is running.');
}

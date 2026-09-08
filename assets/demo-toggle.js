/* プレビュー（仮データ）の切り替え — 2026-09-08新設
   ねらい：デモ用URL（?demo=1）へ行く手段が無く、本番と見比べられなかった。
           画面の左下に小さな切り替えを常設し、1タップで往復できるようにする。

   使い方：demo を持つページ（admin / jisseki）で <script src="assets/demo-toggle.js?v=1"></script> を読むだけ。
           ページ側の実装（ADMIN_DEMO / JST_DEMO）はそのまま。ここは「行き来する手段」だけを足す。

   置き場をここ1つにしている理由＝各ページへ同じコードを配らない（世代差が出るため）。 */
(function () {
  function boot() {
    if (document.getElementById('demoToggle')) return;
    var params = new URLSearchParams(location.search);
    var on = params.get('demo') === '1';

    // 行き先URL（他のパラメータは保つ）
    var to = new URLSearchParams(location.search);
    if (on) to.delete('demo'); else to.set('demo', '1');
    var href = location.pathname + (to.toString() ? '?' + to.toString() : '') + location.hash;

    var css = document.createElement('style');
    css.textContent =
      '#demoToggle{position:fixed;left:12px;bottom:12px;z-index:80;display:flex;align-items:center;gap:8px;' +
      'padding:8px 12px;border-radius:999px;font:600 12px/1.3 system-ui,-apple-system,"Hiragino Sans",sans-serif;' +
      'text-decoration:none;box-shadow:0 6px 18px rgba(0,0,0,.16);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);' +
      'border:1px solid rgba(255,255,255,.5);transition:transform .15s ease,box-shadow .15s ease}' +
      '#demoToggle:hover{transform:translateY(-1px);box-shadow:0 10px 24px rgba(0,0,0,.22)}' +
      '#demoToggle .dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto}' +
      '#demoToggle.live{background:rgba(255,255,255,.82);color:#3d5245}' +
      '#demoToggle.live .dot{background:#8aa394}' +
      '#demoToggle.demo{background:rgba(180,120,20,.94);color:#fff;border-color:rgba(255,255,255,.35)}' +
      '#demoToggle.demo .dot{background:#ffd98a}' +
      '@media(max-width:560px){#demoToggle{left:10px;bottom:10px;padding:7px 11px;font-size:11px}}' +
      '@media print{#demoToggle{display:none}}';
    document.head.appendChild(css);

    var a = document.createElement('a');
    a.id = 'demoToggle';
    a.className = on ? 'demo' : 'live';
    a.href = href;
    a.innerHTML = '<span class="dot"></span>' +
      (on ? '<span>プレビュー表示中 ／ <u>本番に戻る</u></span>'
          : '<span>プレビュー（仮データ）を見る</span>');
    a.title = on
      ? 'いまは仮データです。押すと本番のデータに戻ります。'
      : '仮データで画面の見え方だけを確認します。押しても本番のデータは変わりません。';
    document.body.appendChild(a);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

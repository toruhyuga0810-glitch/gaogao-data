// ナビの液体ハイライト：ホバーしたタブへ2つの玉（速い/遅い）が追従し、
// SVGの#gooフィルターで輪郭が融合して液体のように伸びてくっつく
(function(){
  document.querySelectorAll('nav.tabs, nav.navlinks').forEach(function(nav){
    if(nav.querySelector('.goo-layer')) return;
    var layer=document.createElement('div'); layer.className='goo-layer';
    var b1=document.createElement('div'); b1.className='goo-blob goo-b1';
    var b2=document.createElement('div'); b2.className='goo-blob goo-b2';
    layer.appendChild(b1); layer.appendChild(b2);
    nav.insertBefore(layer, nav.firstChild);
    function place(el, target){
      var nr=nav.getBoundingClientRect(), r=target.getBoundingClientRect();
      el.style.width=r.width+'px';
      el.style.height=r.height+'px';
      el.style.transform='translate('+(r.left-nr.left)+'px,'+(r.top-nr.top)+'px)';
      el.style.opacity='1';
    }
    function rest(){
      var act=nav.querySelector('a.active');
      if(act){ place(b1,act); place(b2,act); }
      else { b1.style.opacity='0'; b2.style.opacity='0'; }
    }
    nav.querySelectorAll('a').forEach(function(a){
      a.addEventListener('mouseenter', function(){ place(b1,a); place(b2,a); });
    });
    nav.addEventListener('mouseleave', rest);
    window.addEventListener('resize', rest);
    // 初期状態：現在ページのタブに座らせる（レイアウト確定後）
    requestAnimationFrame(function(){ b1.style.transition='none'; b2.style.transition='none'; rest();
      requestAnimationFrame(function(){ b1.style.transition=''; b2.style.transition=''; }); });
  });
})();

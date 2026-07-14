// Apple風リキッドグラスナビ：白いピルがバネの動きでホバー先へスライドし、
// マウスを追う光（グレア）がガラスの中を動く
(function(){
  function init(nav){
    if(nav.querySelector('.nav-pill')) return;
    var glareC=document.createElement('div'); glareC.className='liquid-glare-container';
    var glare=document.createElement('div'); glare.className='liquid-glare';
    glareC.appendChild(glare);
    var pill=document.createElement('div'); pill.className='nav-pill';
    nav.insertBefore(pill, nav.firstChild);
    nav.insertBefore(glareC, nav.firstChild);
    var spring='transform 0.5s cubic-bezier(0.34,1.2,0.64,1), width 0.5s cubic-bezier(0.34,1.2,0.64,1), height 0.5s cubic-bezier(0.34,1.2,0.64,1)';
    function place(btn, smooth){
      if(!btn){ pill.style.opacity='0'; return; }
      pill.style.transition = (smooth===false) ? 'none' : spring;
      pill.style.width=btn.offsetWidth+'px';
      pill.style.height=btn.offsetHeight+'px';
      pill.style.transform='translate('+btn.offsetLeft+'px,'+btn.offsetTop+'px)';
      pill.style.opacity='1';
    }
    nav.querySelectorAll('a').forEach(function(a){
      a.addEventListener('mouseenter', function(){ place(a); });
    });
    nav.addEventListener('mouseleave', function(){ place(nav.querySelector('a.active')); });
    window.addEventListener('resize', function(){
      place(nav.querySelector('a:hover')||nav.querySelector('a.active'), false);
    });
    nav.addEventListener('mousemove', function(e){
      var r=nav.getBoundingClientRect();
      glare.style.setProperty('--x',(e.clientX-r.left)+'px');
      glare.style.setProperty('--y',(e.clientY-r.top)+'px');
    });
    // 初期表示：現在ページのタブへ（アニメなしで着席）
    setTimeout(function(){ place(nav.querySelector('a.active'), false); void pill.offsetWidth; }, 50);
  }
  document.querySelectorAll('nav.tabs, nav.navlinks').forEach(init);
})();

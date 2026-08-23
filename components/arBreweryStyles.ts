/* AR 양조 체험 공통 스타일 — 술 종류와 무관하게 항상 동일. 엔진에서 주입한다. */
export const styles = `
.ar-ui{position:absolute; inset:0; display:flex; flex-direction:column; overflow:hidden;
  font-family:var(--font-gowun), system-ui, sans-serif;
  color:#f3e6cc;
  /* 앱 팔레트에 맞춘 지역 별칭 — --hanji/--seal/--gold/--sage 등은 :root 것을 그대로 쓴다 */
  --cream:var(--hanji); --cream-dim:rgba(243,230,204,.66); --panel-2:#3a2c1c;
  --clay:var(--seal); --clay-hi:#c9573c; --sage-deep:var(--gold);
  --line:rgba(232,201,138,.22);
  --r-md:16px; --r-sm:14px; --safe-b:env(safe-area-inset-bottom,0px);
  padding-top:20px;}
.ar-ui canvas#gl{position:absolute; inset:0; width:100%; height:100%; display:block; z-index:0}
/* 냉각 단계 비네트 — 캔버스 위, 오버레이 UI 아래. 가장자리만 살짝 어둡게 */
.ar-ui .vignette{position:absolute; inset:0; pointer-events:none; opacity:0; transition:opacity .7s ease; z-index:1;
  background:radial-gradient(ellipse at center, transparent 42%, rgba(0,0,0,.55) 100%)}
.ar-ui.cooling .vignette{opacity:1}
.ar-ui.aging-focus .vignette{opacity:1;
  background:radial-gradient(ellipse 78% 42% at 50% 52%, rgba(21,119,179,.025) 0%, rgba(7,68,111,.1) 30%, rgba(2,34,65,.28) 56%, rgba(0,12,31,.68) 80%, rgba(0,2,10,.94) 100%)}
.ar-ui .aging-complete-screen{position:absolute; inset:0; z-index:10000; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:14px; pointer-events:none; visibility:hidden; opacity:0;
  color:#fff0d4; text-align:center;
  background:radial-gradient(ellipse 72% 58% at 50% 48%, #0a3154 0%, #041b34 38%, #010a18 72%, #00040b 100%);
  box-shadow:inset 0 0 120px rgba(0,55,105,.42); transition:opacity .42s ease}
.ar-ui .aging-complete-screen span{font-size:clamp(18px,5vw,26px); line-height:1.2; font-weight:500;
  letter-spacing:.06em; text-shadow:0 0 18px rgba(244,202,135,.25)}
.ar-ui .aging-complete-screen strong{font-family:var(--display); font-size:clamp(34px,9vw,54px); line-height:1.18;
  font-weight:600; letter-spacing:-.02em; text-shadow:0 0 24px rgba(244,202,135,.22)}
.ar-ui .aging-complete-screen small{margin-top:20px; font-size:clamp(14px,3.8vw,19px); font-weight:400;
  letter-spacing:.04em; color:rgba(230,239,249,.78); text-shadow:0 0 16px rgba(94,174,235,.3)}
.ar-ui.aging-complete > :not(.aging-complete-screen){visibility:hidden!important}
.ar-ui.aging-complete .aging-complete-screen{visibility:visible; opacity:1; pointer-events:auto; cursor:pointer;
  touch-action:manipulation; -webkit-tap-highlight-color:transparent}
.ar-ui > *{position:relative; z-index:1}

/* 냉각① tray pull 기술 검증 패널 — URL에 ?trayDebug=1이 있을 때만 root class가 붙는다. */
.ar-ui .tray-debug-panel{display:none}
.ar-ui.tray-debug .tray-debug-panel{display:grid; position:absolute; z-index:12; top:70px; right:10px;
  width:min(205px,calc(100% - 20px)); box-sizing:border-box; gap:3px; padding:10px 12px;
  pointer-events:none; border:1px solid rgba(82,216,255,.52); border-radius:10px;
  background:rgba(8,16,20,.86); color:rgba(235,247,250,.72); backdrop-filter:blur(6px);
  box-shadow:0 8px 24px rgba(0,0,0,.38); font:10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace}
.ar-ui .tray-debug-panel > div:not(.tray-debug-title){display:flex; justify-content:space-between; gap:10px}
.ar-ui .tray-debug-panel b{color:#f5fbfc; font-weight:700; font-variant-numeric:tabular-nums}
.ar-ui .tray-debug-title{margin-bottom:3px; color:#52d8ff; font-weight:800; letter-spacing:.04em}
.ar-ui #tray-debug-ok{display:none; margin-top:5px; padding:6px; border-radius:6px;
  background:#3f7a4e; color:#fff; text-align:center; letter-spacing:.05em}
.ar-ui #tray-debug-ok.visible{display:block}
.ar-ui #tray-debug-reset{pointer-events:auto; margin-top:5px; padding:7px 8px; border:1px solid rgba(82,216,255,.55);
  border-radius:6px; background:rgba(82,216,255,.12); color:#bdefff; font:700 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace;
  letter-spacing:.04em; cursor:pointer; -webkit-tap-highlight-color:transparent}
.ar-ui #tray-debug-reset:active{background:rgba(82,216,255,.28)}

/* 냉각② rice spread 기술 검증 UI — URL의 riceSpreadDebug root class에서만 노출. */
.ar-ui .rice-debug-panel,.ar-ui #rice-debug-palm-marker{display:none}
.ar-ui.rice-spread-debug .rice-debug-panel{display:grid; position:absolute; z-index:12; top:70px; right:10px;
  width:min(218px,calc(100% - 20px)); box-sizing:border-box; gap:3px; padding:10px 12px;
  pointer-events:none; border:1px solid rgba(105,217,138,.55); border-radius:10px;
  background:rgba(8,18,13,.88); color:rgba(237,249,240,.72); backdrop-filter:blur(6px);
  box-shadow:0 8px 24px rgba(0,0,0,.38); font:10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace}
.ar-ui .rice-debug-panel > div:not(.rice-debug-title){display:flex; justify-content:space-between; gap:10px}
.ar-ui .rice-debug-panel b{color:#f5fcf7; font-weight:700; font-variant-numeric:tabular-nums}
.ar-ui .rice-debug-title{margin-bottom:3px; color:#69d98a; font-weight:800; letter-spacing:.04em}
.ar-ui #rice-debug-spread,.ar-ui #rice-debug-ok{display:none; margin-top:5px; padding:6px; border-radius:6px;
  color:#fff; text-align:center; font-style:normal; font-weight:800; letter-spacing:.05em}
.ar-ui #rice-debug-spread{background:#317b92}
.ar-ui #rice-debug-ok{background:#3f7a4e}
.ar-ui #rice-debug-spread.visible,.ar-ui #rice-debug-ok.visible{display:block}
.ar-ui #rice-debug-reset{pointer-events:auto; margin-top:5px; padding:7px 8px; border:1px solid rgba(105,217,138,.58);
  border-radius:6px; background:rgba(105,217,138,.12); color:#c7f3d2; font:700 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace;
  letter-spacing:.04em; cursor:pointer; -webkit-tap-highlight-color:transparent}
.ar-ui #rice-debug-reset:active{background:rgba(105,217,138,.28)}
.ar-ui.rice-spread-debug #rice-debug-palm-marker.visible{display:block; position:absolute; z-index:11;
  width:14px; height:14px; margin:-7px 0 0 -7px; border:2px solid #69d98a; border-radius:50%;
  background:rgba(105,217,138,.24); box-shadow:0 0 10px rgba(105,217,138,.9); pointer-events:none}

/* 밑술② knead gesture 기술 검증 — production UI에는 노출하지 않는다. */
.ar-ui .knead-debug-panel,.ar-ui #knead-debug-palm-marker{display:none}
.ar-ui.knead-debug .knead-debug-panel{display:grid; position:absolute; z-index:12; top:70px; right:10px;
  width:min(226px,calc(100% - 20px)); box-sizing:border-box; gap:3px; padding:10px 12px;
  pointer-events:none; border:1px solid rgba(232,192,122,.58); border-radius:10px;
  background:rgba(23,16,9,.9); color:rgba(249,240,220,.72); backdrop-filter:blur(6px);
  box-shadow:0 8px 24px rgba(0,0,0,.4); font:10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace}
.ar-ui .knead-debug-panel > div:not(.knead-debug-title){display:flex; justify-content:space-between; gap:10px}
.ar-ui .knead-debug-panel b{color:#fff8e8; font-weight:700; font-variant-numeric:tabular-nums}
.ar-ui .knead-debug-title{margin-bottom:3px; color:#e8c07a; font-weight:800; letter-spacing:.04em}
.ar-ui #knead-debug-feedback,.ar-ui #knead-debug-ok{margin-top:5px; padding:6px; border-radius:6px;
  color:#fff; text-align:center; font-style:normal; font-weight:800; letter-spacing:.05em}
.ar-ui #knead-debug-feedback{display:block; background:#76502e}
.ar-ui #knead-debug-ok{display:none; background:#3f7a4e}
.ar-ui #knead-debug-ok.visible{display:block}
.ar-ui #knead-debug-reset{pointer-events:auto; margin-top:5px; padding:7px 8px; border:1px solid rgba(232,192,122,.62);
  border-radius:6px; background:rgba(232,192,122,.12); color:#f4d99d;
  font:700 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.04em;
  cursor:pointer; -webkit-tap-highlight-color:transparent}
.ar-ui #knead-debug-reset:active{background:rgba(232,192,122,.28)}
.ar-ui.knead-debug #knead-debug-palm-marker.visible{display:block; position:absolute; z-index:11;
  width:14px; height:14px; margin:-7px 0 0 -7px; border:2px solid #e8c07a; border-radius:50%;
  background:rgba(232,192,122,.24); box-shadow:0 0 10px rgba(232,192,122,.9); pointer-events:none}
.ar-ui.knead-debug #p-ferment .steps,
.ar-ui.knead-debug #p-ferment .steps-hint,
.ar-ui.knead-debug #p-ferment .dock{display:none}

/* 밑술 production 혼합 QA — mitsulMixDebug query에서만 보인다. */
.ar-ui .mitsul-debug-panel{display:none}
.ar-ui.mitsul-mix-debug .mitsul-debug-panel{display:grid; position:absolute; z-index:12; top:70px; right:10px;
  width:min(226px,calc(100% - 20px)); box-sizing:border-box; gap:3px; padding:10px 12px;
  pointer-events:none; border:1px solid rgba(222,174,100,.6); border-radius:10px;
  background:rgba(25,17,9,.9); color:rgba(249,240,220,.72); backdrop-filter:blur(6px);
  box-shadow:0 8px 24px rgba(0,0,0,.4); font:10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace}
.ar-ui .mitsul-debug-panel > div:not(.mitsul-debug-title){display:flex; justify-content:space-between; gap:10px}
.ar-ui .mitsul-debug-panel b{color:#fff8e8; font-weight:700; font-variant-numeric:tabular-nums}
.ar-ui .mitsul-debug-title{margin-bottom:3px; color:#e8c07a; font-weight:800; letter-spacing:.04em}
.ar-ui #mitsul-debug-ok{display:none; margin-top:5px; padding:6px; border-radius:6px;
  background:#3f7a4e; color:#fff; text-align:center; letter-spacing:.05em}
.ar-ui #mitsul-debug-ok.visible{display:block}
.ar-ui #mitsul-debug-reset{pointer-events:auto; margin-top:5px; padding:7px 8px; border:1px solid rgba(232,192,122,.62);
  border-radius:6px; background:rgba(232,192,122,.12); color:#f4d99d;
  font:700 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.04em; cursor:pointer}
.ar-ui #mitsul-debug-reset:active{background:rgba(232,192,122,.28)}

/* 밑술 1차 발효 QA — production에는 노출하지 않는다. */
.ar-ui .mitsul-ferment-debug-panel{display:none}
.ar-ui.mitsul-ferment-debug .mitsul-ferment-debug-panel{display:grid; position:absolute; z-index:12; top:70px; right:10px;
  width:min(230px,calc(100% - 20px)); box-sizing:border-box; gap:3px; padding:10px 12px;
  pointer-events:none; border:1px solid rgba(246,190,108,.62); border-radius:10px;
  background:rgba(24,15,8,.91); color:rgba(250,240,218,.72); backdrop-filter:blur(6px);
  box-shadow:0 8px 24px rgba(0,0,0,.42); font:10px/1.35 ui-monospace,SFMono-Regular,Consolas,monospace}
.ar-ui .mitsul-ferment-debug-panel > div:not(.mitsul-ferment-debug-title){display:flex; justify-content:space-between; gap:10px}
.ar-ui .mitsul-ferment-debug-panel b{color:#fff7e5; font-weight:700; font-variant-numeric:tabular-nums}
.ar-ui .mitsul-ferment-debug-title{margin-bottom:3px; color:#f0bd72; font-weight:800; letter-spacing:.04em}
.ar-ui #mitsul-ferment-debug-ok{display:none; margin-top:5px; padding:6px; border-radius:6px;
  background:#3f7a4e; color:#fff; text-align:center; letter-spacing:.05em}
.ar-ui #mitsul-ferment-debug-ok.visible{display:block}
.ar-ui #mitsul-ferment-debug-reset{pointer-events:auto; margin-top:5px; padding:7px 8px;
  border:1px solid rgba(240,189,114,.65); border-radius:6px; background:rgba(240,189,114,.12); color:#f7d7a5;
  font:700 10px/1 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.04em; cursor:pointer}
.ar-ui #mitsul-ferment-debug-reset:active{background:rgba(240,189,114,.28)}

.ar-ui.ar-mode{background:transparent}
.ar-ui.ar-mode canvas#gl{background:transparent}
.ar-ui.ar-mode .lead h2{text-shadow:0 2px 12px rgba(0,0,0,.75)}
.ar-ui.ar-mode .lead p{color:#f3e6cc; text-shadow:0 1px 8px rgba(0,0,0,.8)}
.ar-ui.ar-mode .caption{color:#f3e6cc; text-shadow:0 1px 8px rgba(0,0,0,.8)}

/* 손 상태 표시 — 지금 손이 무엇을 하고 있는지 한 줄로 알려준다.
   (인식됨 / 원료 위 / 잡음 / 담음) 이 바뀔 때마다 문구와 색이 함께 바뀐다. */
.ar-ui .hand-hud{display:none; align-items:center; gap:9px; align-self:center;
  max-width:100%; padding:8px 15px; border-radius:999px;
  background:rgba(28,21,12,.82); border:1px solid var(--line);
  backdrop-filter:blur(6px); font-size:12.5px; color:var(--cream-dim);
  box-shadow:0 10px 24px rgba(0,0,0,.4)}
.ar-ui.hands-on .hand-hud{display:flex}
.ar-ui.mitsul-no-hands #p-ferment .hand-hud{display:none}
.ar-ui .hand-hud .lamp{width:8px; height:8px; border-radius:50%; flex:none;
  background:rgba(243,230,204,.35); transition:background .18s ease, box-shadow .18s ease}
.ar-ui .hand-hud[data-state="tracking"] .lamp{background:var(--sage); box-shadow:0 0 8px var(--sage)}
.ar-ui .hand-hud[data-state="hover"] .lamp{background:var(--gold-bright); box-shadow:0 0 9px var(--gold-bright)}
.ar-ui .hand-hud[data-state="hover"]{color:var(--gold-bright)}
.ar-ui .hand-hud[data-state="holding"] .lamp{background:var(--clay); box-shadow:0 0 10px var(--clay)}
.ar-ui .hand-hud[data-state="holding"]{color:#f3e6cc; border-color:rgba(194,69,47,.5)}
.ar-ui .hand-hud[data-state="dropped"] .lamp{background:var(--sage); box-shadow:0 0 10px var(--sage)}
.ar-ui .hand-hud[data-state="dropped"]{color:var(--sage)}


.ar-ui .fill{flex:1; position:relative}
/* 하단 여백은 헤더 위 여백과 비슷하게 — 버튼이 화면 끝에 붙지 않도록 */
.ar-ui .dock{padding:0 22px calc(34px + var(--safe-b)); display:flex; flex-direction:column; gap:14px}
/* 첫 화면 안내문은 카메라 화면 가운데에 */
.ar-ui .lead-center{display:flex; align-items:center; justify-content:center; padding:0 22px}

.ar-ui .coach{display:flex; gap:12px; align-items:flex-start; background:var(--cream); color:var(--ink-strong);
  border:1px solid rgba(198,165,104,.4); border-radius:var(--r-md); padding:14px 15px;
  box-shadow:0 8px 20px rgba(120,95,50,.22);
  animation:ar-rise .34s cubic-bezier(.2,.8,.3,1) both}
@keyframes ar-rise{from{opacity:0; transform:translateY(10px)}to{opacity:1; transform:none}}
.ar-ui .coach .avatar{width:28px;height:28px;border-radius:50%;flex:none;margin-top:2px;
  background:radial-gradient(circle at 35% 30%, #e8c98a, #a67c3e)}
.ar-ui .coach .who{font-size:11px; font-weight:700; color:var(--clay); letter-spacing:.02em}
.ar-ui .coach .msg{font-size:13px; line-height:1.65; margin-top:4px; color:var(--ink-soft)}

.ar-ui .choices{display:flex; flex-direction:column; gap:9px; margin-top:12px}
.ar-ui .choice{text-align:left; width:100%; cursor:pointer; background:var(--hanji-bright);
  border:1px solid rgba(198,165,104,.45); color:var(--ink-strong); font:inherit; font-size:13px;
  padding:12px 14px; border-radius:var(--r-sm); transition:.18s}
.ar-ui .choice.ok{background:var(--sage); border-color:#8ea77f}
.ar-ui .choice.no{background:#f4e0da; border-color:#c58c80}

/* 재료 고르기 — 네모 상자 없이 재료만 놓인 것처럼.
   투명 PNG라 배경색을 깔면 테두리처럼 비쳐 보이므로 색을 주지 않고,
   대신 그림자로 카메라 화면 위에서도 또렷하게 보이게 한다. */
.ar-ui .grid{display:grid; grid-template-columns:repeat(3,1fr); gap:4px}
.ar-ui .card{background:none; border:none; border-radius:12px; padding:8px 4px 6px; cursor:pointer;
  color:var(--cream-dim); display:flex; flex-direction:column; align-items:center; gap:7px;
  font:inherit; font-size:12px; text-shadow:0 1px 6px rgba(0,0,0,.85);
  -webkit-tap-highlight-color:transparent; transition:.2s}
.ar-ui .card .chip{width:54px; height:54px; background-color:transparent;
  background-size:contain; background-repeat:no-repeat; background-position:center;
  filter:drop-shadow(0 3px 7px rgba(0,0,0,.6)); transition:transform .22s, filter .22s}
.ar-ui .card[aria-pressed="true"]{color:var(--gold-bright); font-weight:700}
.ar-ui .card[aria-pressed="true"] .chip{transform:scale(1.18) translateY(-2px);
  filter:drop-shadow(0 0 11px rgba(232,201,138,.9)) drop-shadow(0 4px 8px rgba(0,0,0,.5))}
.ar-ui .card:active .chip{transform:scale(.94)}

/* 고두밥 공정 진행 표시 — 점과 선으로 잇는 타임라인.
   지금 눌러야 할 단계만 인주색으로 살아 있어, 어디를 눌러야 하는지 바로 보인다. */
.ar-ui .steps{display:flex; align-items:flex-start; padding:0 20px; margin-top:2px}
.ar-ui .pill{position:relative; z-index:1; flex:1; display:flex; flex-direction:column; align-items:center; gap:8px;
  border:none; background:none; padding:0; cursor:default; font:inherit; font-size:11.5px; font-weight:600;
  color:rgba(243,230,204,.42); text-shadow:0 1px 6px rgba(0,0,0,.7); transition:.2s}
.ar-ui .pill::before{content:""; box-sizing:border-box; width:22px; height:22px; border-radius:50%;
  background:var(--panel-2); border:2px solid rgba(232,201,138,.3);
  display:grid; place-items:center; font-size:12px; line-height:1; transition:.2s}
/* 다음 점까지 잇는 선 (마지막 단계 제외) */
.ar-ui .pill::after{content:""; position:absolute; z-index:-1; top:10px; left:50%; width:100%; height:2px;
  background:rgba(232,201,138,.25)}
.ar-ui .pill:last-child::after{display:none}
.ar-ui .pill[data-state="done"]{color:rgba(243,230,204,.72)}
.ar-ui .pill[data-state="done"]::before{content:"✓"; color:var(--ink); background:var(--sage); border-color:var(--sage)}
.ar-ui .pill[data-state="done"]::after{background:var(--sage)}
.ar-ui .pill[data-state="now"]{color:var(--gold-bright); cursor:pointer}
.ar-ui .pill[data-state="now"]::before{background:var(--clay); border-color:#dd8a72;
  animation:ar-pulse 1.8s ease-in-out infinite}

/* 덧술 1·2: 출고/숙성 단계와 같은 보상형 타임라인 UI를 사용한다.
   단계별 아이콘만 CSS 변수로 나누고 크기·색·진입·맥동 로직은 공유한다. */
.ar-ui #ferment-pills .pill[data-step-id="mash1"]{
  --mash-step-icon:url("/ar/ui/mash1-pour-icon.png");
}
.ar-ui #ferment-pills .pill[data-step-id="mash2"]{
  --mash-step-icon:url("/ar/ui/mash2-pour-icon.png");
}

.ar-ui #ferment-pills .pill:is([data-step-id="mash1"],[data-step-id="mash2"])[data-state="todo"]::before{
  content:"";
  width:22px;
  height:22px;
  margin-top:0;
  border-width:1px;
  background:
    var(--mash-step-icon) center / 15px 15px no-repeat,
    var(--panel-2);
}

.ar-ui #ferment-pills .pill:is([data-step-id="mash1"],[data-step-id="mash2"])[data-state="now"]{
  color:#f4bd72;
  font-weight:700;
  text-shadow:
    0 1px 5px rgba(0,0,0,.75),
    0 0 8px rgba(240,155,66,.34);
}

.ar-ui #ferment-pills .pill:is([data-step-id="mash1"],[data-step-id="mash2"])[data-state="now"]::before{
  content:"";
  width:34px;
  height:34px;
  margin-top:-6px;
  border-radius:50%;
  background:
    var(--mash-step-icon) center / 24px 24px no-repeat,
    radial-gradient(circle at 40% 34%,#b64e2d 0%,#963720 58%,#742419 100%);
  border:2px solid #f2aa50;
  box-shadow:
    0 0 0 2px rgba(255,180,74,.22),
    0 0 7px 2px rgba(255,166,55,.72),
    0 0 18px 5px rgba(224,93,25,.42),
    inset 0 1px 5px rgba(255,198,111,.24),
    0 2px 5px rgba(0,0,0,.22);
  transform-origin:center;
  animation:
    ar-ship-step-enter .46s cubic-bezier(.18,.82,.24,1.18) both,
    ar-ship-step-glow 1.8s .46s ease-in-out infinite;
}

/* 후발효 단계: 저온숙성·출고와 같은 방식으로 항아리 아이콘을 표시한다. */
.ar-ui #ferment-pills .pill[data-step-id="post"][data-state="todo"]::before{
  content:"";
  width:22px;
  height:22px;
  margin-top:0;
  border-width:1px;
  background:
    url("/ar/ui/post-fermentation-jar-icon.png") center / 15px 15px no-repeat,
    var(--panel-2);
}

.ar-ui #ferment-pills .pill[data-step-id="post"][data-state="now"]{
  color:#f4bd72;
  font-weight:700;
  text-shadow:
    0 1px 5px rgba(0,0,0,.75),
    0 0 8px rgba(240,155,66,.34);
}

.ar-ui #ferment-pills .pill[data-step-id="post"][data-state="now"]::before{
  content:"";
  width:34px;
  height:34px;
  margin-top:-6px;
  border-radius:50%;
  background:
    url("/ar/ui/post-fermentation-jar-icon.png") center / 24px 24px no-repeat,
    radial-gradient(circle at 40% 34%,#b64e2d 0%,#963720 58%,#742419 100%);
  border:2px solid #f2aa50;
  box-shadow:
    0 0 0 2px rgba(255,180,74,.22),
    0 0 7px 2px rgba(255,166,55,.72),
    0 0 18px 5px rgba(224,93,25,.42),
    inset 0 1px 5px rgba(255,198,111,.24),
    0 2px 5px rgba(0,0,0,.22);
  transform-origin:center;
  animation:
    ar-ship-step-enter .46s cubic-bezier(.18,.82,.24,1.18) both,
    ar-ship-step-glow 1.8s .46s ease-in-out infinite;
}

/* 압착·여과와 저온숙성: 같은 보상형 상태 UI를 공유한다.
   상태 전환과 크기·글로우는 같고 단계별 이미지만 CSS 변수로 나눈다. */
.ar-ui #press-pills .pill[data-step-id="press"]{
  --finish-step-icon:url("/ar/ui/press-filter-icon.png");
  --finish-step-icon-todo-size:13.5px 13.5px;
  --finish-step-icon-now-size:21.6px 21.6px;
}
.ar-ui #press-pills .pill[data-step-id="aging"]{
  --finish-step-icon:url("/ar/ui/aging-cold-jar-icon.png");
  --finish-step-icon-todo-size:15px 15px;
  --finish-step-icon-now-size:24px 24px;
}
.ar-ui #press-pills .pill:is([data-step-id="press"],[data-step-id="aging"])[data-state="todo"]::before{
  content:"";
  width:22px;
  height:22px;
  margin-top:0;
  border-width:1px;
  background:
    var(--finish-step-icon) center / var(--finish-step-icon-todo-size) no-repeat,
    var(--panel-2);
}

.ar-ui #press-pills .pill:is([data-step-id="press"],[data-step-id="aging"])[data-state="now"]{
  color:#f4bd72;
  font-weight:700;
  text-shadow:
    0 1px 5px rgba(0,0,0,.75),
    0 0 8px rgba(240,155,66,.34);
}

.ar-ui #press-pills .pill:is([data-step-id="press"],[data-step-id="aging"])[data-state="now"]::before{
  content:"";
  width:34px;
  height:34px;
  margin-top:-6px;
  border-radius:50%;
  background:
    var(--finish-step-icon) center / var(--finish-step-icon-now-size) no-repeat,
    radial-gradient(circle at 40% 34%,#b64e2d 0%,#963720 58%,#742419 100%);
  border:2px solid #f2aa50;
  box-shadow:
    0 0 0 2px rgba(255,180,74,.22),
    0 0 7px 2px rgba(255,166,55,.72),
    0 0 18px 5px rgba(224,93,25,.42),
    inset 0 1px 5px rgba(255,198,111,.24),
    0 2px 5px rgba(0,0,0,.22);
  transform-origin:center;
  animation:
    ar-ship-step-enter .46s cubic-bezier(.18,.82,.24,1.18) both,
    ar-ship-step-glow 1.8s .46s ease-in-out infinite;
}

/* =========================================================
 * 출고 단계 전용 액센트
 * 압착·여과 / 저온숙성은 기존 컬러 유지
 * 마지막 '출고'에는 완성 병 픽토그램을 사용한다.
 * ======================================================= */

.ar-ui #press-pills .pill:last-child[data-state="todo"]::before{
  content:"";
  width:22px;
  height:22px;
  margin-top:0;
  border-width:1px;
  background:
    url("/ar/ui/shipping-bottle-icon.png") center / 11px 11px no-repeat,
    var(--panel-2);
}

.ar-ui #press-pills .pill:last-child[data-state="now"]{
  color:#f4bd72;
  font-weight:700;
  text-shadow:
    0 1px 5px rgba(0,0,0,.75),
    0 0 8px rgba(240,155,66,.34);
}

.ar-ui #press-pills .pill:last-child[data-state="now"]::before{
  content:"";

  width:34px;
  height:34px;
  margin-top:-6px;
  border-radius:50%;

  /* 앞쪽 PNG = 완성 병, 뒤쪽 그라데이션 = 출고 진행 상태 */
  background:
    url("/ar/ui/shipping-bottle-icon.png")
      center / 24px 24px
      no-repeat,
    radial-gradient(
      circle at 40% 34%,
      #b64e2d 0%,
      #963720 58%,
      #742419 100%
    );

  border:2px solid #f2aa50;

  box-shadow:
    0 0 0 2px rgba(255,180,74,.22),
    0 0 7px 2px rgba(255,166,55,.72),
    0 0 18px 5px rgba(224,93,25,.42),
    inset 0 1px 5px rgba(255,198,111,.24),
    0 2px 5px rgba(0,0,0,.22);

  transform-origin:center;
  animation:
    ar-ship-step-enter .46s cubic-bezier(.18,.82,.24,1.18) both,
    ar-ship-step-glow 1.8s .46s ease-in-out infinite;
}

@keyframes ar-ship-step-enter{
  0%{transform:scale(.68);opacity:.35}
  72%{transform:scale(1.07);opacity:1}
  100%{transform:scale(1);opacity:1}
}

@keyframes ar-ship-step-glow{
  0%,100%{
    box-shadow:
      0 0 0 2px rgba(255,180,74,.22),
      0 0 7px 2px rgba(255,166,55,.72),
      0 0 18px 5px rgba(224,93,25,.42),
      inset 0 1px 5px rgba(255,198,111,.24),
      0 2px 5px rgba(0,0,0,.22);
  }
  50%{
    box-shadow:
      0 0 0 3px rgba(255,190,90,.28),
      0 0 10px 3px rgba(255,171,60,.86),
      0 0 24px 7px rgba(224,93,25,.52),
      inset 0 1px 7px rgba(255,211,132,.3),
      0 2px 5px rgba(0,0,0,.22);
  }
}

/* 출고 인터랙션과 완료 CTA에서만 핑크를 주색으로 사용한다. */
.ar-ui #btn-finishing.shipping:not(.waiting){
  color:#fff;
  background:linear-gradient(135deg,#ec7895,#d94f73);
  border-color:rgba(255,210,220,.82);
  box-shadow:0 8px 24px rgba(213,72,111,.3), inset 0 1px rgba(255,255,255,.35);
  animation:ar-ship-cta 1.7s ease-in-out infinite;
}

@keyframes ar-ship-cta{
  0%,100%{transform:translateY(0); box-shadow:0 8px 24px rgba(213,72,111,.25)}
  50%{transform:translateY(-2px); box-shadow:0 10px 30px rgba(236,120,149,.42)}
}

@keyframes ar-paw-pulse{
  0%,100%{
    transform:scale(1);
    box-shadow:
      0 0 0 4px rgba(255,157,181,.14),
      0 0 12px rgba(255,137,166,.45);
  }

  50%{
    transform:scale(1.1);
    box-shadow:
      0 0 0 8px rgba(255,157,181,0),
      0 0 20px rgba(255,137,166,.75);
  }
}

@keyframes ar-pulse{0%,100%{box-shadow:0 0 0 0 rgba(181,72,47,.55)}50%{box-shadow:0 0 0 8px rgba(181,72,47,0)}}
.ar-ui .steps-hint{margin:10px 22px 0; text-align:center; font-size:12px; line-height:1.55;
  color:var(--gold-bright); word-break:keep-all; text-shadow:0 1px 6px rgba(0,0,0,.75)}
/* 문구가 없는 단계에서는 자리째 접는다 — 빈 줄의 여백만 남지 않게 */
.ar-ui .steps-hint:empty{display:none}

.ar-ui .caption{position:absolute; left:0; right:0; bottom:18px; text-align:center; font-size:12px; color:var(--cream-dim)}

/* 덧술 채반을 선반에서 꺼낸 뒤, 바닥 배치 방법을 설명하는 카드. */
.ar-ui .mash-tray-place-guide{display:flex; align-items:center; gap:14px; box-sizing:border-box;
  width:100%; padding:13px 15px; border:1px solid rgba(198,165,104,.4); border-radius:18px;
  color:var(--ink-strong); background:rgba(249,241,225,.96);
  box-shadow:0 8px 24px rgba(38,24,12,.22); pointer-events:none}
.ar-ui .mash-tray-place-guide img{display:block; flex:0 0 80px; width:80px; height:80px;
  object-fit:cover; border-radius:12px; mix-blend-mode:multiply}
.ar-ui .mash-tray-place-guide div{display:flex; flex-direction:column; min-width:0; gap:6px}
.ar-ui .mash-tray-place-guide strong{font-size:14px; line-height:1.55; letter-spacing:-.02em;
  color:var(--ink-strong); word-break:keep-all}
.ar-ui .mash-tray-place-guide span{font-size:11px; line-height:1.45; color:var(--ink-faint); word-break:keep-all}

/* 덧술2 안내 — 화면 가운데에서 한 번 더 할지 물어본다.
   구석의 작은 버튼은 처음 하는 사람이 못 찾는다. */
.ar-ui .ask-sheet{position:absolute; inset:0; z-index:70; display:flex;
  align-items:center; justify-content:center; padding:26px;
  background:rgba(16,11,6,.88); backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
  pointer-events:auto; animation:ar-fade .28s ease both}
.ar-ui .ask-sheet.hidden{display:none}
.ar-ui .ask-card{width:100%; max-width:320px; box-sizing:border-box;
  display:flex; flex-direction:column; gap:12px; padding:24px 22px;
  border:1px solid rgba(198,165,104,.4); border-radius:20px;
  background:var(--cream); color:var(--ink-strong);
  box-shadow:0 22px 54px -18px rgba(0,0,0,.7); text-align:center}
.ar-ui .ask-eyebrow{font-size:11px; font-weight:700; letter-spacing:.06em; color:var(--clay)}
.ar-ui .ask-card strong{font-family:var(--font-myeongjo), serif; font-size:19px;
  line-height:1.5; color:var(--ink); word-break:keep-all}
.ar-ui .ask-card p{margin:0 0 6px; font-size:13px; line-height:1.75;
  color:var(--ink-soft); word-break:keep-all}
.ar-ui .ask-card .cta{width:100%}
.ar-ui .ask-card .cta.ghost{border:1px solid rgba(58,44,27,.28);
  background:rgba(255,255,255,.5); color:var(--ink-soft)}

.ar-ui .meter{background:var(--cream); color:var(--ink-strong); border:1px solid rgba(198,165,104,.4);
  border-radius:var(--r-md); padding:14px 15px}
.ar-ui .meter .row{display:flex; justify-content:space-between; align-items:baseline; font-size:12.5px; font-weight:600}
.ar-ui .meter .val{color:var(--clay); font-size:14px; font-variant-numeric:tabular-nums}
.ar-ui .meter input[type=range]{-webkit-appearance:none; appearance:none; width:100%; height:9px; margin:12px 0 0;
  border-radius:999px; outline:none; background:linear-gradient(90deg,#3f7a4e,#8fae4a,#e0b23c,#d1662f,#b7332a)}
.ar-ui .meter input[type=range]::-webkit-slider-thumb{-webkit-appearance:none; width:19px;height:19px;border-radius:50%;
  background:#fff; border:2px solid var(--brown); cursor:pointer}
.ar-ui .meter input[type=range]::-moz-range-thumb{width:19px;height:19px;border-radius:50%;background:#fff;border:2px solid var(--brown)}

.ar-ui .bar{height:8px; border-radius:999px; background:rgba(232,201,138,.18); overflow:hidden}
.ar-ui .bar i{display:block; height:100%; width:0; background:var(--sage-deep);
  transition:width .4s linear, background .3s}
/* 온도가 어긋나면 진행 막대와 안내 문구가 함께 색으로 알려준다 */
.ar-ui .bar i[data-state="warn"]{background:#d8a441}
.ar-ui .bar i[data-state="bad"]{background:var(--clay)}
.ar-ui .ferment-row{display:flex; justify-content:space-between; align-items:baseline; gap:12px;
  font-size:12.5px; line-height:1.5; color:var(--cream-dim); text-shadow:0 1px 6px rgba(0,0,0,.7)}
.ar-ui .ferment-row .ferment-rate{min-width:0; word-break:keep-all}
.ar-ui .ferment-row .ferment-pct{flex:none; font-variant-numeric:tabular-nums}
/* 온도 게임 묶음 — 후발효에서만 보인다. dock과 같은 간격을 안에서 유지한다. */
.ar-ui #ferment-game{display:flex; flex-direction:column; gap:14px}
/* 온도 묶음 안쪽도 같은 간격을 준다 — 없으면 '준비 완료' 줄이 막대에 붙는다 */
.ar-ui #ferment-temp-controls{display:flex; flex-direction:column; gap:12px}
.ar-ui #ferment-temp-controls.hidden{display:none}
.ar-ui #godubap-game,
.ar-ui #mitsul-mix-game{display:flex; flex-direction:column; gap:12px; padding:14px 15px;
  border:1px solid var(--line); border-radius:var(--r-md); background:rgba(28,21,12,.82);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px)}
.ar-ui #mitsul-mix-game.hidden{display:none}
.ar-ui #mitsul-timelapse{display:flex; flex-direction:column; gap:12px; padding:14px 15px;
  border:1px solid var(--line); border-radius:var(--r-md); background:rgba(28,21,12,.82); backdrop-filter:blur(6px)}
.ar-ui #mitsul-timelapse.hidden{display:none}
.ar-ui .mitsul-ferment-message{font-size:13px; line-height:1.55; color:var(--cream); text-align:center}
.ar-ui #btn-mitsul-mix.complete{background:#3f7a4e; color:#fff; opacity:1}
.ar-ui .ferment-rate[data-state="ok"]{color:var(--sage)}
.ar-ui .ferment-rate[data-state="warn"]{color:#e8c07a}
.ar-ui .ferment-rate[data-state="bad"]{color:#e8927a}
.ar-ui .ferment-pct{font-weight:700; color:var(--gold-bright); font-variant-numeric:tabular-nums}
.ar-ui .meter .val[data-state="ok"]{color:#3f7a4e}
.ar-ui .meter .val[data-state="warn"]{color:#c1862a}
.ar-ui .meter .val[data-state="bad"]{color:var(--clay)}

/* 앱의 .btn-seal(인주 강조버튼)과 같은 규격 — 그림자 없이 색만 다르게 */
.ar-ui .cta{width:100%; box-sizing:border-box; border:1px solid transparent; font-family:var(--font-myeongjo), serif;
  font-weight:700; font-size:15px; line-height:1.3; letter-spacing:.02em; color:#fbeee5; background:var(--clay);
  padding:15px; border-radius:14px; cursor:pointer; box-shadow:none; transition:.2s}
.ar-ui .cta:hover:not(:disabled){background:var(--clay-hi)}
.ar-ui .cta:disabled{background:#3a2c1c; color:rgba(243,230,204,.35); cursor:default}
/* 아직 다음으로 넘어갈 수 없는 상태 — 비활성처럼 보이되 눌리면 안내창을 띄운다 */
.ar-ui .cta.waiting{background:#3a2c1c; color:rgba(243,230,204,.5)}
.ar-ui .cta.waiting:hover{background:#463620}
.ar-ui .cta.ghost{background:transparent; border-color:var(--line); color:var(--cream-dim)}

.ar-ui .seg{display:flex; gap:8px; justify-content:center}
.ar-ui .seg button{border:1px solid var(--line); background:transparent; color:var(--cream-dim); font:inherit;
  font-size:12.5px; padding:9px 16px; border-radius:999px; cursor:pointer}
.ar-ui .seg button[aria-pressed="true"]{background:var(--sage); border-color:var(--sage); color:var(--ink); font-weight:600}

.ar-ui .lead{text-align:center}
.ar-ui .lead h2{margin:0; font-family:var(--font-myeongjo), serif; font-size:19px; letter-spacing:.02em; font-weight:700}
.ar-ui .lead p{margin:10px 0 0; font-size:13px; line-height:1.7; color:var(--cream-dim)}

/* 완료 화면 — 앱의 한지 배경으로 */
/* 위아래 여백을 헤더 위 간격과 비슷하게 두어 내용이 화면 가운데 놓이게 한다 */
.ar-ui #finish{position:absolute; inset:0; display:none; flex-direction:column; align-items:center;
  justify-content:center; text-align:center; padding:46px 22px calc(46px + var(--safe-b));
  overflow-y:auto;
  background:linear-gradient(180deg,#f3ece0 0%,#e7dac3 100%); color:var(--ink);
  animation:ar-rise .5s cubic-bezier(.2,.8,.3,1) both}
/* 도감 카드와 같은 3:4 비율로, 여백 없이 꽉 채운다 */
.ar-ui #finish .finish-drink{width:138px; aspect-ratio:3/4; height:auto; object-fit:cover; display:block;
  border-radius:14px; background:var(--hanji-bright); border:1px solid rgba(198,165,104,.4);
  box-shadow:0 12px 30px rgba(120,95,50,.18); padding:0; margin-bottom:20px}
.ar-ui #finish h1{margin:0; font-family:var(--font-myeongjo), serif; font-size:22px; line-height:1.45;
  letter-spacing:.02em; color:var(--ink)}
.ar-ui #finish p{margin:12px 0 20px; font-size:13px; line-height:1.75; color:var(--ink-soft); max-width:300px}
/* 버튼은 색만 다르게. 위 두 개는 한 줄에 반씩, 아래 하나는 전체 폭 */
.ar-ui #finish .cta{max-width:320px; box-sizing:border-box; display:block; text-align:center; text-decoration:none}
.ar-ui #finish .finish-actions{display:flex; gap:10px; width:100%; max-width:320px}
.ar-ui #finish .finish-actions .cta{flex:1; min-width:0; max-width:none; font-size:14px; padding:14px 8px;
  line-height:1.35; word-break:keep-all}
.ar-ui #finish .finish-actions + .cta{margin-top:10px}
.ar-ui #finish .dex-link{background:var(--brown); color:#f3e6cc}
.ar-ui #finish .dex-link:hover{background:var(--brown-deep)}
/* 밝은 배경에서는 앱의 .btn-outline 처럼 */
.ar-ui #finish .cta.ghost{border:1px solid rgba(58,44,27,.3); background:rgba(255,255,255,.5); color:var(--ink-strong)}

.ar-ui #report{position:absolute; inset:0; background:rgba(36,27,16,.62); backdrop-filter:blur(3px);
  display:none; align-items:flex-end; z-index:20}
.ar-ui #report.open{display:flex}
.ar-ui #report .sheet{width:100%; background:var(--cream); color:var(--ink-strong); border-radius:18px 18px 0 0;
  border-top:1px solid rgba(198,165,104,.4);
  padding:22px 22px calc(22px + var(--safe-b)); animation:ar-up .32s cubic-bezier(.2,.8,.3,1) both}
@keyframes ar-up{from{transform:translateY(100%)}to{transform:none}}
.ar-ui #report h3{margin:0 0 4px; font-family:var(--font-myeongjo), serif; font-size:17px; color:var(--ink)}
.ar-ui #report .sub{font-size:12px; color:var(--ink-faint); margin-bottom:16px}
.ar-ui #report dl{display:grid; grid-template-columns:auto 1fr; gap:11px 14px; margin:0 0 18px; font-size:13px}
.ar-ui #report dt{color:var(--ink-faint)}
.ar-ui #report dd{margin:0; text-align:right; font-weight:600; color:var(--ink-strong)}

/* 안내 알림 — 리포트와 같은 재질이되 화면 가운데에 뜬다 */
.ar-ui #notice{position:absolute; inset:0; background:rgba(36,27,16,.62); backdrop-filter:blur(3px);
  display:none; align-items:center; justify-content:center; padding:22px; z-index:90; pointer-events:auto}
.ar-ui #notice.open{display:flex}
.ar-ui #notice .sheet{width:100%; max-width:296px; background:var(--cream); color:var(--ink-strong);
  border-radius:18px; border:1px solid rgba(198,165,104,.4); text-align:center;
  padding:24px 22px; animation:ar-pop .28s cubic-bezier(.2,.8,.3,1) both}
@keyframes ar-pop{from{opacity:0; transform:scale(.94)}to{opacity:1; transform:none}}
.ar-ui #notice p{margin:0 0 18px; font-size:13.5px; line-height:1.75; color:var(--ink-soft); word-break:keep-all}

.ar-ui .hidden{display:none !important}
/* 단계 패널은 화면 전체를 덮으므로 포인터를 통과시킨다.
   그래야 3D 모드에서 캔버스를 드래그해 시점을 돌릴 수 있다.
   실제로 눌러야 하는 영역(하단 조작부·진행 표시)만 다시 살린다. */
.ar-ui .panel-step{display:none; flex-direction:column; flex:1; pointer-events:none}
.ar-ui .dock, .ar-ui .steps{pointer-events:auto}
.ar-ui[data-step="place"] #p-place,
.ar-ui[data-step="ingredient"] #p-ingredient,
.ar-ui[data-step="godubap"] #p-godubap,
.ar-ui[data-step="ferment"] #p-ferment{display:flex}
/* 완성(done) 단계는 두 국면 — 먼저 완성 공정 walkthrough, 다 마치면(.shipped) 축하 화면 */
.ar-ui[data-step="done"] #p-finishing{display:flex}
.ar-ui[data-step="done"].shipped #p-finishing{display:none}
.ar-ui[data-step="done"].shipped #finish{display:flex}

/* 완성 공정 패널 — 배경을 깔지 않아 AR 카메라 화면이 그대로 유지된다.
   (한지 배경으로 덮으면 카메라가 사라진 것처럼 보여 '나가진다'고 느껴진다) */
.ar-ui #p-finishing{position:relative; background:transparent}

/* =========================================================
 * 출고 시네마틱 — Three.js 병 타임라인과 data-ship-sequence로 동기화
 * settling → reveal → celebrate → message → result → ready
 * ======================================================= */
.ar-ui[data-ship-sequence] #press-pills,
.ar-ui[data-ship-sequence] #finishing-hint,
.ar-ui[data-ship-sequence] #p-finishing>.dock{
  opacity:1; filter:none; transition:none; pointer-events:none}
.ar-ui[data-ship-sequence] #cap-finishing{opacity:0}
.ar-ui .ship-story{position:absolute; inset:0; z-index:8; pointer-events:none; overflow:hidden}
.ar-ui .ship-complete-copy{position:absolute; left:22px; right:22px; bottom:18%; text-align:center;
  padding:25px 20px 22px; border-radius:38px; color:#fff8ef;
  background:linear-gradient(180deg,rgba(67,38,19,.2),rgba(42,24,13,.62));
  border:1px solid rgba(255,224,190,.2); backdrop-filter:blur(7px);
  opacity:0; transform:translateY(10px); transition:opacity .48s ease,transform .55s cubic-bezier(.2,.8,.3,1)}
.ar-ui .ship-copy-paws{position:absolute;right:18px;top:-18px;width:64px;height:54px;display:block;pointer-events:none}
.ar-ui .ship-copy-paws img{position:absolute;width:30px;height:30px;object-fit:contain;filter:drop-shadow(0 0 9px rgba(247,155,177,.72))}
.ar-ui .ship-copy-paws img:first-child{left:1px;bottom:0;transform:rotate(-16deg)}
.ar-ui .ship-copy-paws img:last-child{right:0;top:0;transform:rotate(12deg) scale(.86)}
.ar-ui .ship-complete-copy h2,.ar-ui .ship-result-card h2{margin:0; font-family:var(--font-myeongjo),serif;
  font-size:25px; font-weight:700; letter-spacing:.015em; text-shadow:0 2px 12px rgba(0,0,0,.45)}
.ar-ui .ship-complete-copy h2 em,.ar-ui .ship-result-card h2 em{color:inherit;font-style:normal}
.ar-ui .ship-complete-copy p{margin:8px 0 0; color:rgba(255,245,231,.78); font-size:12.5px}
.ar-ui[data-ship-sequence="message"] .ship-complete-copy,
.ar-ui[data-ship-sequence="result"] .ship-complete-copy{opacity:1;transform:none}

.ar-ui .ship-result-card{position:absolute; left:16px; right:16px; bottom:calc(16px + var(--safe-b));
  max-width:390px; margin:auto; box-sizing:border-box; padding:31px 18px 18px; border-radius:31px;
  color:#fff8ef; text-align:center;
  background:linear-gradient(180deg,#462716,#2d190f);
  border:1px solid rgba(255,235,211,.34);
  box-shadow:0 16px 42px rgba(24,12,5,.25),inset 0 1px 0 rgba(255,255,255,.12);
  -webkit-backdrop-filter:blur(9px) saturate(.92);backdrop-filter:blur(9px) saturate(.92);
  opacity:0; transform:translateY(calc(100% + 40px));
  transition:opacity .55s ease,transform .7s cubic-bezier(.18,.8,.22,1); pointer-events:none}
.ar-ui .ship-result-card::before{content:"";position:absolute;z-index:0;left:50%;top:-19px;width:86px;height:38px;
  box-sizing:border-box;transform:translateX(-50%);border:1px solid rgba(255,235,211,.34);border-bottom:0;border-radius:44px 44px 0 0;
  background:#462716}
.ar-ui .ship-result-card>*{position:relative;z-index:1}
.ar-ui[data-ship-sequence="result"] .ship-result-card,
.ar-ui[data-ship-sequence="ready"] .ship-result-card{opacity:1;transform:none}
.ar-ui[data-ship-sequence="ready"] .ship-result-card{pointer-events:auto}
.ar-ui[data-ship-sequence="result"] .ship-complete-copy,
.ar-ui[data-ship-sequence="ready"] .ship-complete-copy{opacity:0;transform:translateY(-8px)}
.ar-ui .ship-card-crest{width:50px;height:38px;display:grid;place-items:center;margin:-39px auto 10px;filter:drop-shadow(0 3px 5px rgba(20,10,4,.24))}
.ar-ui .ship-card-crest img{display:block;width:100%;height:100%;object-fit:contain}
.ar-ui .ship-result-card h2{font-size:22px;color:#fff8ef;text-shadow:0 2px 12px rgba(18,8,3,.28)}
.ar-ui .ship-card-note{margin:7px 0 14px;font-size:12px;color:rgba(255,239,221,.72)}
.ar-ui .ship-row,.ar-ui .ship-save-row{width:100%;box-sizing:border-box;border:1px solid rgba(119,73,42,.16);
  border-radius:17px;background:rgba(255,246,235,.76);color:#3e2819;padding:12px 13px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.42);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.ar-ui .ship-row{display:grid;grid-template-columns:34px 1fr 18px;align-items:center;text-align:left;font:inherit;cursor:pointer}
.ar-ui .ship-row-icon{display:block;width:31px;height:27px;object-fit:contain;filter:drop-shadow(0 1px 2px rgba(49,25,12,.16))}
.ar-ui .ship-row b{font-family:var(--font-myeongjo),serif;font-size:14px}.ar-ui .ship-row i{font-style:normal;font-size:24px}
.ar-ui .ship-save-row{display:grid;grid-template-columns:45px 1fr 18px;align-items:center;gap:10px;margin-top:9px;text-align:left;font:inherit;cursor:pointer}
.ar-ui .ship-result-thumb{display:block;width:45px;height:45px;overflow:hidden;border-radius:9px;border:1px solid rgba(102,61,36,.18);background:rgba(74,42,24,.18)}
.ar-ui .ship-result-thumb img{display:block;width:100%;height:100%;object-fit:cover;object-position:center;transform:scale(1.42)}
.ar-ui .ship-save-row span{min-width:0}.ar-ui .ship-save-row b{display:block;font-family:var(--font-myeongjo),serif;font-size:14px}
.ar-ui .ship-save-row small{display:block;margin-top:3px;color:#806049;font-size:9.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ar-ui .ship-save-row i{font-style:normal;font-size:24px;color:#7a5636}
.ar-ui .ship-save-row:active{transform:scale(.995)}
.ar-ui .ship-primary{width:100%;margin-top:11px;padding:15px;border:1px solid rgba(255,231,196,.34);
  border-radius:16px;color:#fff6e6;font-family:var(--font-myeongjo),serif;
  font-size:15px;font-weight:700;letter-spacing:.01em;
  background:linear-gradient(135deg,#c2452f,#9d3320);
  box-shadow:0 8px 20px rgba(60,20,10,.32),inset 0 1px 0 rgba(255,255,255,.14);
  display:flex;align-items:center;justify-content:center}
.ar-ui .ship-primary:active{transform:scale(.99);background:linear-gradient(135deg,#b03d2a,#8c2d1c)}

/* 촬영 모드: 브라우저가 AR compositor 캡처를 막는 경우에도 같은 프레임으로 시스템 스크린샷 가능 */
.ar-ui .ship-capture-ui{position:absolute;inset:0;z-index:60;display:none;flex-direction:column;padding:calc(22px + env(safe-area-inset-top,0px)) 22px calc(22px + var(--safe-b));
  box-sizing:border-box;background:transparent;
  color:#fff;pointer-events:auto}
.ar-ui.ship-capture .ship-capture-ui{display:flex;animation:ar-fade .25s ease both}
.ar-ui.ship-capture .ship-story{visibility:hidden!important;opacity:0!important}
.ar-ui.ship-capture #btn-finishing{visibility:hidden!important;opacity:0!important;pointer-events:none!important}
@keyframes ar-fade{from{opacity:0}to{opacity:1}}
.ar-ui .ship-capture-ui header{display:flex;z-index:2;align-items:center;justify-content:center;position:relative;font-size:17px}
.ar-ui .capture-frame{position:relative;z-index:1;flex:1;margin:58px auto 18px;width:min(82vw,360px);max-height:59vh;border:1px solid rgba(255,255,255,.9);box-shadow:0 0 0 100vmax rgba(5,4,3,.66)}
.ar-ui .capture-frame .corner{position:absolute;width:28px;height:28px;border-color:#fff;border-style:solid;filter:drop-shadow(0 0 5px #ffd79a)}
.ar-ui .capture-frame .tl{left:-3px;top:-3px;border-width:4px 0 0 4px;border-radius:10px 0 0}.ar-ui .capture-frame .tr{right:-3px;top:-3px;border-width:4px 4px 0 0;border-radius:0 10px 0 0}
.ar-ui .capture-frame .bl{left:-3px;bottom:-3px;border-width:0 0 4px 4px;border-radius:0 0 0 10px}.ar-ui .capture-frame .br{right:-3px;bottom:-3px;border-width:0 4px 4px 0;border-radius:0 0 10px}
.ar-ui .capture-label-sticker{position:absolute;right:5%;bottom:8%;display:block;width:37%;height:auto;transform:rotate(4deg);filter:drop-shadow(0 7px 10px rgba(0,0,0,.28));opacity:1;visibility:visible;animation:none!important}
.ar-ui .ship-capture-ui>p{position:relative;z-index:2;text-align:center;color:#f1d6a4;font-size:11px;margin:0 0 20px}
.ar-ui .ship-capture-ui footer{position:relative;z-index:2;display:grid;grid-template-columns:minmax(0,1fr) 70px minmax(0,1fr);gap:12px;align-items:center;text-align:center}
.ar-ui .ship-capture-ui footer button{border:0;background:none;color:#fff;font:inherit;font-size:13px}
.ar-ui .capture-shutter{position:relative;width:70px;height:70px;padding:0!important;border-radius:50%!important;background:transparent!important;border:3px solid #fff!important;display:grid;place-items:center;overflow:hidden;transform:translateZ(0);transition:transform .1s ease}
.ar-ui .capture-shutter::before{content:"";position:absolute;inset:-1px;border-radius:50%;background:#fff;transform:scale(1);transition:transform .12s ease}
.ar-ui .capture-shutter svg{position:relative;z-index:1;display:block;width:34px;height:34px;fill:#2a1b11;transform:scale(1);transition:transform .12s ease}
.ar-ui .capture-shutter svg .lens{fill:none;stroke:#f6ecd6;stroke-width:2.2}
.ar-ui .capture-shutter:active,.ar-ui .capture-shutter.is-capturing{transform:scale(.99)}
.ar-ui .capture-shutter:active::before,.ar-ui .capture-shutter.is-capturing::before{transform:scale(.90)}
.ar-ui .capture-shutter:active svg,.ar-ui .capture-shutter.is-capturing svg{transform:scale(.92)}
.ar-ui #btn-capture-cancel{justify-self:center;width:max-content;max-width:100%;white-space:nowrap;padding:8px 14px!important;border:1px solid rgba(255,255,255,.45)!important;border-radius:999px!important;background:rgba(0,0,0,.12)}

@media (prefers-reduced-motion:reduce){.ar-ui *{animation:none !important; transition:none !important}}

/* ── 개발용 ─────────────────────────────────────────────
   ?devJump=1 일 때만 나오는 단계 이동 버튼. 평소 화면에는 없다. */
.ar-ui .dev-jump{display:none}
.ar-ui.dev-jump-on .dev-jump{position:absolute; top:180px; left:12px; z-index:9998;
  display:flex; flex-direction:column; align-items:flex-start; gap:8px; pointer-events:auto}
.ar-ui .dev-jump button{padding:8px 12px; border-radius:8px;
  border:1px solid rgba(255,255,255,.4); background:rgba(0,0,0,.7); color:#fff;
  font:inherit; font-size:11px; font-weight:700; white-space:nowrap}

/* ?agingDebug=1 일 때만 보이는 저온숙성 손 판정 값 */
.ar-ui #aging-hand-debug{display:none}
.ar-ui.aging-debug #aging-hand-debug{display:block; position:absolute; top:80px; right:12px; z-index:9999;
  min-width:190px; margin:0; padding:8px 10px; border-radius:8px;
  border:1px solid rgba(141,225,255,.5); background:rgba(0,12,20,.78); color:#b9efff;
  font-family:monospace; font-size:10px; line-height:1.45;
  white-space:pre-wrap; pointer-events:none}
`;
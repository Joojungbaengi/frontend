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
.ar-ui > *{position:relative; z-index:1}

.ar-ui.ar-mode{background:transparent}
.ar-ui.ar-mode canvas#gl{background:transparent}
.ar-ui.ar-mode .lead h2{text-shadow:0 2px 12px rgba(0,0,0,.75)}
.ar-ui.ar-mode .lead p{color:#f3e6cc; text-shadow:0 1px 8px rgba(0,0,0,.8)}
.ar-ui.ar-mode .caption{color:#f3e6cc; text-shadow:0 1px 8px rgba(0,0,0,.8)}

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
@keyframes ar-pulse{0%,100%{box-shadow:0 0 0 0 rgba(181,72,47,.55)}50%{box-shadow:0 0 0 8px rgba(181,72,47,0)}}
.ar-ui .steps-hint{margin:10px 22px 0; text-align:center; font-size:12px; color:var(--gold-bright);
  text-shadow:0 1px 6px rgba(0,0,0,.75)}

.ar-ui .caption{position:absolute; left:0; right:0; bottom:18px; text-align:center; font-size:12px; color:var(--cream-dim)}

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
.ar-ui .ferment-row{display:flex; justify-content:space-between; align-items:baseline; font-size:12.5px;
  color:var(--cream-dim); text-shadow:0 1px 6px rgba(0,0,0,.7)}
/* 온도 게임 묶음 — 후발효에서만 보인다. dock과 같은 간격을 안에서 유지한다. */
.ar-ui #ferment-game{display:flex; flex-direction:column; gap:14px}
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
.ar-ui #p-finishing{background:transparent}

@media (prefers-reduced-motion:reduce){.ar-ui *{animation:none !important; transition:none !important}}
`;
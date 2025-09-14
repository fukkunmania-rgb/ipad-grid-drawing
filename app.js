(() => {
  'use strict';

  // 固定内部解像度（A4比率）
  const IW = 1448;
  const IH = 2048;
  const ASPECT = IH / IW;

  // 要素参照
  const workspace = document.getElementById('workspace');
  const paneA = document.getElementById('paneA');
  const paneB = document.getElementById('paneB');
  const canvasA = document.getElementById('canvasA');
  const canvasB = document.getElementById('canvasB');
  const gridB = document.getElementById('gridB');
  const ctxA = canvasA.getContext('2d');
  const ctxB = canvasB.getContext('2d');
  const ctxGridB = gridB.getContext('2d');

  // 上部UI
  const progressEl = document.getElementById('progress');
  const remainEl = document.getElementById('remain');
  const durationInput = document.getElementById('duration');
  const startBtn = document.getElementById('startBtn');
  const giveUpBtn = document.getElementById('giveUpBtn');
  const refFile = document.getElementById('refFile');
  const gridDivSelect = document.getElementById('gridDiv');
  const gridWidthInput = document.getElementById('gridWidth');
  const penSize = document.getElementById('penSize');
  const clearBtn = document.getElementById('clearBtn');
  const lockedMsg = document.getElementById('lockedMsg');

  // フィードバック
  const feedbackSec = document.getElementById('feedback');
  const fbA = document.getElementById('fbA');
  const fbB = document.getElementById('fbB');
  const fbActx = fbA ? fbA.getContext('2d') : null;
  const fbBctx = fbB ? fbB.getContext('2d') : null;
  const compositeCanvas = document.getElementById('composite');
  const compositeCtx = compositeCanvas.getContext('2d');
  const viewModeBtn = document.getElementById('viewModeBtn');
  const aOpacityInput = document.getElementById('aOpacity');
  const saveBtn = document.getElementById('saveBtn');
  const resetBtn = document.getElementById('resetBtn');

  // 状態
  let refImage = null; // HTMLImageElement
  let gridDivisions = parseInt(gridDivSelect ? gridDivSelect.value : '5', 10) || 5;
  let gridLineWidth = parseInt(gridWidthInput ? gridWidthInput.value : '4', 10) || 4;
  let drawing = false;
  let locked = false;
  let lastX = 0, lastY = 0;
  let fbViewMode = 'overlay'; // 互換用（デフォルトは常にA+B）
  let aOpacity = (aOpacityInput ? parseInt(aOpacityInput.value, 10) : 50) / 100; // 0..1

  // タイマー
  let timerId = null;
  let durationSec = parseInt(durationInput ? durationInput.value : '60', 10) || 60;
  let endAt = 0;
  let remainingOnPause = null;
  let timerState = 'idle'; // idle|running|paused|finished

  // util
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  // レイアウト（余白は5%）
  function layout() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gutter = Math.min(vw, vh) * 0.05;
    const timerH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timer-height')) || 84;
    const availW = vw - gutter * 2;
    const availH = vh - gutter * 2 - timerH;
    const landscape = vw >= vh;
    let w, h;
    if (landscape) {
      const wByW = (availW - gutter) / 2;
      const wByH = availH / ASPECT;
      w = Math.floor(Math.max(0, Math.min(wByW, wByH)));
      h = Math.floor(w * ASPECT);
      workspace.style.flexDirection = 'row';
    } else {
      const hByH = (availH - gutter) / 2;
      const wByH = hByH / ASPECT;
      const wByW = availW;
      w = Math.floor(Math.max(0, Math.min(wByH, wByW)));
      h = Math.floor(w * ASPECT);
      workspace.style.flexDirection = 'column';
    }
    [paneA, paneB].forEach(p => { p.style.width = `${w}px`; p.style.height = `${h}px`; });
    workspace.style.height = `${availH}px`;
  }

  // A: 参照画像 + グリッド
  function drawGridLines(ctx, n) {
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    if (n > 0) {
      const s = IW / n;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = gridLineWidth;
      const offset = (gridLineWidth % 2 === 1) ? 0.5 : 0;
      for (let i = 1; i < n; i++) {
        const x = Math.round(s * i) + offset;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, IH);
        ctx.stroke();
      }
      for (let y = s; y < IH; y += s) {
        const yy = Math.round(y) + offset;
        ctx.beginPath();
        ctx.moveTo(0, yy);
        ctx.lineTo(IW, yy);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      const o = offset;
      ctx.strokeRect(o, o, IW - 1 - (o ? 0 : 1), IH - 1 - (o ? 0 : 1));
    }
    ctx.restore();
  }

  function drawCanvasA() {
    ctxA.save();
    ctxA.setTransform(1,0,0,1,0,0);
    ctxA.fillStyle = '#ffffff';
    ctxA.fillRect(0,0, IW, IH);
    if (refImage && refImage.complete) {
      const ir = refImage.naturalHeight / refImage.naturalWidth;
      let dw = IW, dh = IW * ir;
      if (dh > IH) { dh = IH; dw = dh / ir; }
      const dx = (IW - dw) / 2;
      const dy = (IH - dh) / 2;
      ctxA.drawImage(refImage, dx, dy, dw, dh);
    }
    drawGridLines(ctxA, gridDivisions);
    ctxA.restore();
  }

  function drawGridB() {
    ctxGridB.save();
    ctxGridB.setTransform(1,0,0,1,0,0);
    ctxGridB.clearRect(0,0, IW, IH);
    drawGridLines(ctxGridB, gridDivisions);
    ctxGridB.restore();
  }

  function clearCanvasB() {
    ctxB.save();
    ctxB.setTransform(1,0,0,1,0,0);
    ctxB.fillStyle = '#ffffff';
    ctxB.fillRect(0,0, IW, IH);
    ctxB.restore();
  }

  // 座標変換
  function toCanvasCoords(clientX, clientY) {
    const rect = canvasB.getBoundingClientRect();
    const scaleX = IW / rect.width;
    const scaleY = IH / rect.height;
    return [ (clientX - rect.left) * scaleX, (clientY - rect.top) * scaleY ];
  }

  // ペン描画（Apple Pencilのみ）
  function penDown(px, py) {
    if (locked) return;
    drawing = true;
    lastX = px; lastY = py;
    const w = clamp(parseInt(penSize ? penSize.value : '3', 10) || 3, 1, 64);
    ctxB.save();
    ctxB.fillStyle = '#000';
    ctxB.beginPath();
    ctxB.arc(px, py, w / 2, 0, Math.PI * 2);
    ctxB.fill();
    ctxB.restore();
  }
  function penMove(px, py) {
    if (!drawing || locked) return;
    ctxB.save();
    ctxB.lineCap = 'round';
    ctxB.lineJoin = 'round';
    ctxB.strokeStyle = '#000';
    ctxB.lineWidth = clamp(parseInt(penSize ? penSize.value : '3', 10) || 3, 1, 64);
    ctxB.beginPath();
    ctxB.moveTo(lastX, lastY);
    ctxB.lineTo(px, py);
    ctxB.stroke();
    ctxB.restore();
    lastX = px; lastY = py;
  }
  function penUp() { drawing = false; }

  // タイマー
  function setStartBtnLabel() {
    if (!startBtn) return;
    startBtn.dataset.state = timerState;
    if (timerState === 'idle' || timerState === 'finished') startBtn.textContent = 'スタート';
    else if (timerState === 'running') startBtn.textContent = '一時停止';
    else if (timerState === 'paused') startBtn.textContent = '再開';
  }
  function startTimerFresh() {
    if (timerId) clearInterval(timerId);
    durationSec = clamp(parseInt(durationInput ? durationInput.value : '60', 10) || 60, 1, 3600);
    endAt = Date.now() + durationSec * 1000;
    locked = false; lockedMsg.hidden = true;
    timerState = 'running'; setStartBtnLabel();
    updateTimer(); timerId = setInterval(updateTimer, 100);
  }
  function pauseTimer() {
    if (timerId) clearInterval(timerId); timerId = null;
    remainingOnPause = Math.max(0, Math.ceil((endAt - Date.now()) / 1000));
    timerState = 'paused'; setStartBtnLabel();
  }
  function resumeTimer() {
    if (remainingOnPause == null) return;
    if (timerId) clearInterval(timerId);
    endAt = Date.now() + remainingOnPause * 1000; remainingOnPause = null;
    timerState = 'running'; setStartBtnLabel();
    updateTimer(); timerId = setInterval(updateTimer, 100);
  }
  function updateTimer() {
    const now = Date.now();
    const remainMs = Math.max(0, endAt - now);
    const remain = Math.ceil(remainMs / 1000);
    const ratioRemain = clamp(remain / durationSec, 0, 1);
    if (progressEl) {
      progressEl.style.width = `${ratioRemain * 100}%`;
      if (ratioRemain <= 0.2) progressEl.style.background = '#e74c3c';
      else if (ratioRemain <= 0.5) progressEl.style.background = '#f1c40f';
      else progressEl.style.background = '#2ecc71';
    }
    if (remainEl) remainEl.textContent = String(remain);
    if (remainMs <= 0) { clearInterval(timerId); timerId = null; onTimeUp(); }
  }
  function onTimeUp() {
    locked = true; lockedMsg.hidden = false;
    timerState = 'finished'; setStartBtnLabel();
    renderFeedbackOverlay();
    // 直ちにA+B表示へ（Aはスライダー既定の不透明度）
    if (fbA) fbA.style.opacity = String(aOpacity);
    if (fbB) fbB.style.display = '';
    makeComposite();
    openFeedback();
  }
  function giveUp() {
    if (timerId) { clearInterval(timerId); timerId = null; }
    onTimeUp();
  }

  // フィードバック（表示用オーバーレイ）
  function renderFeedbackOverlay() {
    if (!fbActx || !fbBctx) return;
    // A層はcanvasAの見た目をそのままコピー（参照画像＋グリッドを確実に反映）
    fbActx.save();
    fbActx.setTransform(1,0,0,1,0,0);
    fbActx.clearRect(0,0,IW,IH);
    fbActx.drawImage(canvasA, 0, 0);
    fbActx.restore();
    // B層
    fbBctx.save();
    fbBctx.setTransform(1,0,0,1,0,0);
    fbBctx.clearRect(0,0,IW,IH);
    fbBctx.drawImage(canvasB, 0, 0);
    fbBctx.restore();
  }

  function setFeedbackViewMode(mode) {
    fbViewMode = mode;
    if (!fbA || !fbB) return;
    if (mode === 'Aonly') {
      fbA.style.opacity = '1';
      fbB.style.display = 'none';
      if (viewModeBtn) viewModeBtn.textContent = 'A+B表示';
    } else {
      fbA.style.opacity = String(aOpacity);
      fbB.style.display = '';
      if (viewModeBtn) viewModeBtn.textContent = 'Aのみ表示';
    }
  }

  // フィードバック（保存用合成）
  function makeComposite() {
    compositeCtx.save();
    compositeCtx.setTransform(1,0,0,1,0,0);
    compositeCtx.clearRect(0,0, IW, IH);
    compositeCtx.globalCompositeOperation = 'source-over';
    compositeCtx.fillStyle = '#ffffff';
    compositeCtx.fillRect(0,0, IW, IH);
    // A画面（canvasA）を半透明で合成
    compositeCtx.globalAlpha = (typeof aOpacity === 'number' ? aOpacity : 0.2);
    compositeCtx.filter = 'grayscale(100%)';
    compositeCtx.drawImage(canvasA, 0, 0);
    compositeCtx.filter = 'none';
    compositeCtx.globalAlpha = 1;
    // Bを乗算で合成（白は影響なし、線だけ重なる）
    const prevOp = compositeCtx.globalCompositeOperation;
    compositeCtx.globalCompositeOperation = 'multiply';
    compositeCtx.drawImage(canvasB, 0, 0);
    compositeCtx.globalCompositeOperation = prevOp;
    compositeCtx.restore();
  }

  // 保存（縦720px）
  function savePng() {
    const targetH = 720;
    const scale = targetH / IH;
    const targetW = Math.round(IW * scale);
    const off = document.createElement('canvas');
    off.width = targetW; off.height = targetH;
    const octx = off.getContext('2d');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0,0,targetW,targetH);
    octx.drawImage(compositeCanvas, 0, 0, targetW, targetH);
    const url = off.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `feedback_${new Date().toISOString().replace(/[:.]/g,'-')}_720h.png`;
    document.body.appendChild(a);
    a.click(); a.remove();
  }

  function openFeedback() { feedbackSec.hidden = false; }
  function closeFeedback() { feedbackSec.hidden = true; }

  function resetSession() {
    if (timerId) clearInterval(timerId); timerId = null;
    progressEl.style.width = '0%';
    remainEl.textContent = String(parseInt(durationInput ? durationInput.value : '60', 10) || 60);
    locked = false; lockedMsg.hidden = true;
    timerState = 'idle'; remainingOnPause = null; setStartBtnLabel();
    clearCanvasB();
    closeFeedback();
  }

  // イベント: ポインタ（Apple Pencilのみ）
  function handlePointerDown(ev) {
    if (ev.pointerType && ev.pointerType !== 'pen') return;
    ev.preventDefault(); ev.stopPropagation();
    const [x,y] = toCanvasCoords(ev.clientX, ev.clientY);
    penDown(x,y);
    try { canvasB.setPointerCapture && canvasB.setPointerCapture(ev.pointerId); } catch (_) {}
  }
  function handlePointerMove(ev) {
    if (!drawing) return;
    if (ev.pointerType && ev.pointerType !== 'pen') return;
    ev.preventDefault(); ev.stopPropagation();
    // まれにpointerupが失われた場合に備えて、押下状態を確認
    if (ev.buttons === 0) { penUp(); return; }
    const [x,y] = toCanvasCoords(ev.clientX, ev.clientY);
    penMove(x,y);
  }
  function handlePointerUp(ev) {
    if (ev.pointerType && ev.pointerType !== 'pen') return;
    ev.preventDefault(); ev.stopPropagation();
    penUp();
    try { canvasB.releasePointerCapture && canvasB.releasePointerCapture(ev.pointerId); } catch (_) {}
  }
  canvasB.addEventListener('pointerdown', handlePointerDown, { passive: false });
  window.addEventListener('pointermove', handlePointerMove, { passive: false });
  window.addEventListener('pointerup', handlePointerUp, { passive: false });
  window.addEventListener('pointercancel', handlePointerUp, { passive: false });
  window.addEventListener('pointerleave', handlePointerUp, { passive: false });
  window.addEventListener('pointerout', handlePointerUp, { passive: false });

  // UIイベント
  if (startBtn) startBtn.addEventListener('click', () => {
    if (timerState === 'idle' || timerState === 'finished') startTimerFresh();
    else if (timerState === 'running') pauseTimer();
    else if (timerState === 'paused') resumeTimer();
  });
  if (giveUpBtn) giveUpBtn.addEventListener('click', giveUp);
  if (durationInput) durationInput.addEventListener('change', () => {
    durationSec = clamp(parseInt(durationInput.value || '60', 10) || 60, 1, 3600);
    remainEl.textContent = String(durationSec);
  });
  if (gridDivSelect) gridDivSelect.addEventListener('change', () => {
    gridDivisions = parseInt(gridDivSelect.value || '0', 10) || 0;
    drawCanvasA();
    drawGridB();
  });
  if (gridWidthInput) gridWidthInput.addEventListener('input', () => {
    gridLineWidth = parseInt(gridWidthInput.value || '1', 10) || 1;
    drawCanvasA();
    drawGridB();
  });
  if (clearBtn) clearBtn.addEventListener('click', clearCanvasB);
  if (refFile) refFile.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { refImage = img; drawCanvasA(); URL.revokeObjectURL(url); };
    img.src = url;
  });
  if (saveBtn) saveBtn.addEventListener('click', savePng);
  if (resetBtn) resetBtn.addEventListener('click', resetSession);
  /* 閉じるボタンは廃止 */
  if (viewModeBtn) viewModeBtn.addEventListener('click', () => {}); // Aのみ表示は削除
  if (aOpacityInput) aOpacityInput.addEventListener('input', () => {
    aOpacity = clamp(parseInt(aOpacityInput.value, 10) / 100, 0, 1);
    if (fbA) fbA.style.opacity = String(aOpacity);
  });

  // ジェスチャ抑止（ダブルタップ拡大など）
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  // ピンチズームを広く抑止（iPadOS 14+ の wheel+ctrl も含む）
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); e.stopPropagation(); } }, { passive: false, capture: true });
  // パームリジェクション: マルチタッチや描画中のTouchは全面的に無効化
  const palmBlocker = (e) => {
    // 入力系は許可
    if (isInteractive(e.target)) return;
    // 2本指以上 → ピンチズーム抑止
    if (e.touches && e.touches.length > 1) { e.preventDefault(); e.stopPropagation(); return; }
    // 描画中は手のひらなどのTouchを無効化
    if (drawing) { e.preventDefault(); e.stopPropagation(); }
  };
  document.addEventListener('touchstart', palmBlocker, { passive: false, capture: true });
  document.addEventListener('touchmove', palmBlocker, { passive: false, capture: true });
  let lastTapTs = 0;
  const isInteractive = (el) => !!(el && el.closest && el.closest('input, select, textarea, button, a, label'));
  const doubleTapBlocker = (e) => {
    // 入力系はスルー（数値入力やスライダーの操作を阻害しない）
    if (isInteractive(e.target)) return;
    // Apple Pencilのpointer系はブロックしない
    if (e.pointerType && e.pointerType === 'pen') return;
    // 描画中はブロックしない（penUpが届かなくなるのを防ぐ）
    if (drawing) return;
    const now = Date.now();
    if (now - lastTapTs <= 350) {
      e.preventDefault();
      e.stopPropagation();
    }
    lastTapTs = now;
  };
  // 画面全体でダブルタップを抑止（指・Apple Pencilを問わず）
  document.addEventListener('touchend', doubleTapBlocker, { passive: false, capture: true });
  document.addEventListener('pointerup', doubleTapBlocker, { passive: false, capture: true });

  // タブ切替や画面遷移などでも安全に終了
  window.addEventListener('blur', () => { drawing = false; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) drawing = false; });

  // まれにズームがかかって戻らない場合に、viewportを再適用して強制的に戻す
  const metaViewport = document.querySelector('meta[name="viewport"]');
  function resetViewport() {
    if (!metaViewport) return;
    const content = 'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no, maximum-scale=1, minimum-scale=1';
    metaViewport.setAttribute('content', content);
  }
  if (window.visualViewport) {
    let zoomTimer = null;
    const onVVChange = () => {
      try {
        const s = window.visualViewport.scale || 1;
        if (s && Math.abs(s - 1) > 0.01) {
          // 少し待っても戻らない場合にリセット
          if (zoomTimer) clearTimeout(zoomTimer);
          zoomTimer = setTimeout(() => { resetViewport(); }, 250);
        }
      } catch (_) {}
    };
    window.visualViewport.addEventListener('resize', onVVChange);
    window.visualViewport.addEventListener('scroll', onVVChange);
  }

  // 初期化
  function init() {
    drawCanvasA();
    clearCanvasB();
    drawGridB();
    remainEl.textContent = String(durationSec);
    setStartBtnLabel();
    layout();
  }
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 50));
  init();
})();

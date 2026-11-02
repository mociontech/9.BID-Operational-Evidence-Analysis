import './style.css';
import QRCode from 'qrcode';
import { connect, staticHosting } from './transport.js';
import { Player } from './player.js';
import { controlUrl, currentScreen, followScreen, openWindow, shareScreen } from './desktop.js';
import { enterFullscreen, setupTabletFullscreen } from './fullscreen.js';
import { formatTime, uniqueId } from './protocol.js';
import screenHome from '../Images/Inicio_Pantalla.png';
import tabletHome from '../Images/Inicio_Tablet.png';
import tabletBackground from '../Images/Fondo_Tablet.png';
import instructions from '../Images/Indicaciones.png';
import reboot from '../Images/Reboot.png';
import back10 from '../Images/Atras_10.png';
import play from '../Images/Play.png';
import forward10 from '../Images/Adelante_10.png';
import back from '../Images/Back.png';

const app = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const isScreen = location.pathname === '/pantalla';
const isTablet = ['/tablet', '/control'].includes(location.pathname);
if (location.pathname === '/control') followScreen();
let transport, connected = false, wakeLock;
const $ = (selector) => document.querySelector(selector);
const message = (text) => { $('#notice').textContent = text; $('#notice').hidden = !text; };

async function fullscreen() {
  await enterFullscreen();
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Not available over LAN HTTP. */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeLock?.released) navigator.wakeLock?.request('screen').then(lock => { wakeLock = lock; }).catch(() => {});
});

if (!isScreen && !isTablet) {
  app.innerHTML = `<section class="launcher"><span class="eyebrow">IDB GROUP · EXPERIENCIA INTERACTIVA</span><h1>Project Supervision<br><em>with Focus on Results</em></h1><p>El video y su control, desde una sola computadora.</p><div class="choices"><button id="open-screen" class="choice primary"><span>01 · VIDEO</span><strong>Abrir televisión</strong><small>Abre el reproductor en otra ventana →</small></button><button id="open-control" class="choice" disabled><span>02 · CONTROLES</span><strong>Abrir control táctil</strong><small>Se vincula automáticamente con el reproductor →</small></button></div><p id="desktop-status" role="status">Primero abre la televisión.</p><p class="footnote">Puedes probar ambas ventanas en este mismo monitor, con mouse o touch.<br>Cuando conectes la televisión, arrastra allí la ventana del video.<br>La pantalla completa es opcional. ${staticHosting ? "Abre ambas ventanas en el mismo navegador y perfil. Se necesita internet para cargar la experiencia." : "No requiere internet."}</p><p id="notice" class="notice" role="alert" hidden></p></section>`;
  $('#open-screen').onclick = () => {
    if (!openWindow('/pantalla', 'totem-screen')) message('Permite las ventanas emergentes de este sitio y vuelve a pulsar Abrir televisión.');
  };
  $('#open-control').onclick = () => {
    const invitation = currentScreen();
    if (invitation && !openWindow(controlUrl(invitation), 'totem-control')) message('Permite las ventanas emergentes de este sitio y vuelve a pulsar Abrir control táctil.');
  };
  const updateLauncher = () => {
    const invitation = currentScreen();
    $('#open-control').disabled = !invitation;
    $('#desktop-status').textContent = invitation ? 'Televisión conectada. Ya puedes abrir el control táctil.' : 'Primero abre la televisión.';
  };
  window.addEventListener('storage', updateLauncher);
  setInterval(updateLauncher, 1000); updateLauncher();
} else if (isScreen) {
  app.innerHTML = `<section class="screen-stage"><img id="screen-home" src="${screenHome}" alt="Project Supervision with Focus on Results. Tap the Tablet to explore."><video id="video" data-video-src="/local-video.mp4" preload="auto" playsinline disablepictureinpicture></video></section>
    <button id="settings" class="settings" aria-label="Abrir configuración">⚙</button>
    <section id="setup" class="overlay"><div class="setup-card"><span class="eyebrow">PREPARACIÓN DE LA TELEVISIÓN</span><h1>Dos vistas. Una computadora.</h1><p>Activa el video y abre el control táctil en otra ventana.<br>Puedes usar ambas ventanas en este mismo monitor o mover el video a una televisión.</p><button id="open-local-control" class="secondary" disabled>Abrir control táctil</button><details class="remote-pairing"><summary>Conectar otro dispositivo (opcional)</summary><div class="pairing"><canvas id="qr"></canvas><div><label for="network">Dirección de esta computadora</label><select id="network"></select><a id="pair-link" target="_blank" rel="noopener">Preparando conexión…</a><button id="copy-link" class="secondary">Copiar enlace</button><small>Solo para controlar desde otro dispositivo en la misma red.</small></div></div></details><p id="connection" role="status">Conectando…</p><button id="arm" class="primary" disabled>Activar pantalla</button><button id="screen-fullscreen" class="secondary">Pantalla completa (opcional)</button><button id="close-setup" class="secondary" hidden>Volver a la pantalla</button><p class="footnote">Activar pantalla habilita el audio y conserva el tamaño de la ventana.<br>Usa pantalla completa después de colocar cada ventana donde prefieras.</p></div></section><p id="notice" class="notice" role="alert" hidden></p>`;
  if (staticHosting) $('.remote-pairing').hidden = true;
  const video = $('#video');
  let mediaPrepared = false;
  const mediaReady = globalThis.BIDVideoCache?.prepare(video, {
    onProgress: percent => message(percent === 100 ? '' : `Preparando video${percent === null ? '...' : `... ${percent}%`}`),
  });
  Promise.resolve(mediaReady).then(() => { mediaPrepared = true; $('#arm').disabled = !connected; });
  let invitation, player, publishing = false, commandQueue = Promise.resolve();
  const update = () => {
    if (!player) return;
    $('#screen-home').hidden = player.mode === 'video';
    video.classList.toggle('visible', player.mode === 'video');
    message(player.error);
    if (!player.ready && player.error) $('#setup').hidden = false;
    publish();
  };
  player = new Player(video, update);
  async function publish() {
    if (!connected || !transport || publishing) return;
    publishing = true;
    try {
      if (invitation) shareScreen(invitation);
      await transport.send('state', player.snapshot());
    } catch { connected = false; }
    finally { publishing = false; }
  }
  const origins = [location.origin];
  try {
    const addresses = staticHosting ? [] : await fetch('/api/network').then(r => r.json());
    addresses.forEach(origin => { if (!origins.includes(origin)) origins.push(origin); });
  } catch { /* Current origin remains usable. */ }
  const select = $('#network');
  for (const origin of origins) select.add(new Option(origin, origin));
  if (['localhost', '127.0.0.1'].includes(location.hostname) && origins.length > 1) select.value = origins[1];
  async function renderInvitation() {
    if (!invitation || staticHosting) return;
    const url = new URL('/tablet', select.value);
    url.searchParams.set('room', invitation.room);
    url.hash = `token=${invitation.token}`;
    $('#pair-link').href = url.href; $('#pair-link').textContent = url.href;
    await QRCode.toCanvas($('#qr'), url.href, { width: 200, margin: 1, color: { dark: '#005bff', light: '#ffffff' } });
  }
  select.onchange = renderInvitation;
  $('#open-local-control').onclick = () => {
    if (invitation && !openWindow(controlUrl(invitation), 'totem-control')) message('Permite las ventanas emergentes de este sitio para abrir el control.');
  };
  $('#screen-fullscreen').onclick = fullscreen;
  $('#copy-link').onclick = async () => {
    try { await navigator.clipboard.writeText($('#pair-link').href); $('#copy-link').textContent = 'Enlace copiado'; }
    catch { message('Selecciona y copia el enlace que aparece junto al QR.'); }
  };
  $('#arm').onclick = async () => {
    $('#arm').disabled = true;
    await mediaReady;
    if (await player.arm()) { $('#setup').hidden = true; $('#close-setup').hidden = false; }
    $('#arm').disabled = !connected;
  };
  $('#settings').onclick = () => { $('#setup').hidden = false; };
  $('#close-setup').onclick = () => { $('#setup').hidden = true; };
  try {
    transport = await connect({ role: 'screen',
      onPaired: () => {},
      onMessage: (kind, payload) => {
        if (kind === 'invitation') {
          invitation = payload; renderInvitation(); shareScreen(invitation);
          $('#open-local-control').disabled = false;
        }
        if (kind === 'command') commandQueue = commandQueue.then(() => player.command(payload)).catch(() => message('No se pudo ejecutar la orden.'));
      },
      onStatus: (online, error) => {
        connected = online;
        $('#connection').textContent = online ? 'Conexión lista' : error || (staticHosting ? 'Abre pantalla y control en el mismo navegador y perfil.' : 'Reconectando al servidor local…');
        $('#arm').disabled = !online || !mediaPrepared;
        publish();
      },
    });
  } catch (error) { message(error.message); }
  setInterval(publish, 400);
} else {
  let state, received = 0, pending = null, pendingTimer, seeking = false;
  const queuedSkips = [];
  app.innerHTML = `<section class="tablet-stage"><button id="tablet-home" class="tablet-home" aria-label="Iniciar video en la pantalla" disabled><img src="${tabletHome}" alt="Project Supervision with Focus on Results. Tap to play the video on the screen."></button><section id="controller" class="controller" hidden><img class="controller-bg" src="${tabletBackground}" alt="Project Supervision with Focus on Results"><div class="timeline"><input id="seek" type="range" min="0" max="100" step="0.1" value="0" aria-label="Posición del video"><div class="times"><output id="elapsed">0:00</output><span id="playback-state"></span><output id="duration">0:00</output></div></div><div class="controls"><button data-action="reboot" aria-label="Reboot: reiniciar y reproducir"><img src="${reboot}" alt="Reboot"></button><button data-action="skip" data-value="-10" aria-label="Retroceder 10 segundos"><img src="${back10}" alt="-10"></button><button id="play-pause" aria-label="Pausar"><img id="play-art" src="${play}" alt="Play"><span id="pause-art"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M22 12v40M42 12v40"/></svg><span>Pause</span></span></button><button data-action="skip" data-value="10" aria-label="Adelantar 10 segundos"><img src="${forward10}" alt="+10"></button><button data-action="back" aria-label="Back: volver al inicio"><img src="${back}" alt="Back"></button></div></section></section><div id="tablet-status" class="tablet-status" role="status">Conectando con la pantalla…</div><p id="notice" class="notice" role="alert" hidden></p>`;
  setupTabletFullscreen();
  const guidance = document.createElement('div');
  guidance.className = 'control-guidance';
  guidance.hidden = true;
  guidance.setAttribute('role', 'status');
  const guidanceImage = new Image();
  guidanceImage.src = instructions;
  guidanceImage.alt = 'Tap the screen to control the video at your own pace';
  guidance.append(guidanceImage);
  $('#controller').append(guidance);
  let guidanceTimer, guidanceKey = null, guidanceComplete = false;
  let controlsPhase = 'home';
  const controlsIdle = globalThis.BIDPlayback.autoHide({
    areas: [$('.controls'), $('.timeline')], active: () => state?.mode === 'video' && !state.intro,
    onChange: visible => {
      $('#controller').classList.toggle('controls-hidden', !visible);
      for (const area of [$('.controls'), $('.timeline')]) area.inert = !visible;
    },
  });
  $('#controller').addEventListener('click', event => {
    if (state?.mode === 'video' && !state.intro && !event.target.closest('.controls, .timeline')) controlsIdle.show(!controlsIdle.visible);
  });
  function hideGuidance() {
    clearTimeout(guidanceTimer);
    guidance.hidden = true;
    $('#controller').classList.remove('show-guidance');
  }
  function showGuidance(key) {
    hideGuidance();
    guidanceKey = key;
    guidanceComplete = false;
    guidance.hidden = false;
    $('#controller').classList.add('show-guidance');
    guidanceTimer = setTimeout(() => {
      hideGuidance();
      guidanceComplete = true;
      finishGuidance();
    }, 6000);
  }
  function finishGuidance() {
    // The screen stays paused until the tablet has removed its instructions.
    if (guidanceComplete && state?.intro && available() && !pending) send('intro-complete');
  }
  const room = params.get('room');
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  // Keep the invitation in the fragment: it is never sent in HTTP requests or referrers.
  const available = () => connected && state?.ready && performance.now() - received < 3000;
  function render() {
    const online = available();
    const active = state?.mode === 'video';
    const phase = active ? state.intro ? 'intro' : 'playing' : 'home';
    if (phase !== controlsPhase) { controlsPhase = phase; controlsIdle.show(phase === 'intro'); }
    if (!active) queuedSkips.length = 0;
    $('#tablet-home').hidden = Boolean(active);
    $('#controller').hidden = !active;
    $('#tablet-home').disabled = !online || Boolean(pending);
    document.querySelectorAll('.controls button, #seek').forEach(button => {
      button.disabled = !online || (Boolean(pending) && button.dataset.action !== 'skip') || (Boolean(state?.intro) && button.dataset.action !== 'back');
    });
    $('#tablet-status').textContent = !room || !token ? 'Abre Televisión y después Abrir control táctil desde la página de inicio.'
      : !connected || (state && performance.now() - received >= 3000) ? 'Sin conexión con la pantalla · Reconectando…'
      : !state ? 'Esperando a la pantalla…' : !state.ready ? 'Activa la pantalla desde la computadora.'
      : '';
    $('#tablet-status').hidden = !$('#tablet-status').textContent;
    if (!state) return;
    if (!seeking) { $('#seek').max = state.duration || 1; $('#seek').value = state.time; }
    $('#seek').style.setProperty('--progress', `${state.duration ? Number($('#seek').value) / state.duration * 100 : 0}%`);
    $('#elapsed').textContent = formatTime(seeking ? Number($('#seek').value) : state.time);
    $('#duration').textContent = formatTime(state.duration);
    $('#playback-state').textContent = state.buffering ? 'Cargando…' : '';
    $('#play-art').hidden = !state.paused; $('#pause-art').hidden = state.paused;
    $('#play-pause').setAttribute('aria-label', state.paused ? 'Reproducir' : 'Pausar');
  }
  async function send(action, value) {
    if (!available()) return;
    if (pending) { if (action === 'skip') queuedSkips.push(value); return; }
    const command = { id: uniqueId(), action, value, boot: state.boot, run: state.run, snapshot: state.snapshot };
    pending = command.id; message(''); render();
    pendingTimer = setTimeout(() => { pending = null; queuedSkips.length = 0; message('La pantalla no confirmó la orden. Revisa la conexión y vuelve a intentarlo.'); render(); }, 4000);
    try { await transport.send('command', command); }
    catch (error) { clearTimeout(pendingTimer); pending = null; queuedSkips.length = 0; message(error.message); render(); }
  }
  $('#tablet-home').onclick = () => { send('start'); };
  document.querySelectorAll('[data-action]').forEach(button => {
    button.onclick = () => send(button.dataset.action, button.dataset.value ? Number(button.dataset.value) : undefined);
  });
  $('#play-pause').onclick = () => send(state.paused ? 'play' : 'pause');
  // Capture the tap before the command temporarily disables its button.
  const feedbackTimers = new WeakMap();
  $('.controls').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    clearTimeout(feedbackTimers.get(button));
    button.classList.remove('tap-feedback');
    void button.offsetWidth;
    button.classList.add('tap-feedback');
    feedbackTimers.set(button, setTimeout(() => button.classList.remove('tap-feedback'), 420));
  }, true);
  $('#seek').oninput = () => { seeking = true; render(); };
  $('#seek').onchange = () => { const value = Number($('#seek').value); seeking = false; send('seek', value); };
  $('#seek').addEventListener('pointercancel', () => { seeking = false; render(); });
  if (room && token) {
    try {
      transport = await connect({ role: 'tablet', room, token, onPaired: () => {},
        onStatus: (online, error) => { connected = online; if (error) message(error); render(); },
        onMessage: (kind, payload) => {
          if (kind !== 'state') return;
          state = payload; received = performance.now();
          if (state.intro) {
            const key = `${state.boot}:${state.run}`;
            if (guidanceKey !== key) showGuidance(key);
          } else { hideGuidance(); guidanceKey = null; guidanceComplete = false; }
          if (pending && state.lastCommand === pending) { clearTimeout(pendingTimer); pending = null; }
          if (state.error) message(state.error);
          render();
          finishGuidance();
          if (!pending && queuedSkips.length && state.mode === 'video' && !state.intro) {
            send('skip', queuedSkips.shift());
          }
        },
      });
    } catch (error) { message(error.message); }
  }
  setInterval(render, 300); render();
}
window.addEventListener('pagehide', () => transport?.close());
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

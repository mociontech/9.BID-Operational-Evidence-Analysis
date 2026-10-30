export const isFullscreen = () => Boolean(
  document.fullscreenElement || document.webkitFullscreenElement
  || window.matchMedia('(display-mode: standalone)').matches
  || window.matchMedia('(display-mode: fullscreen)').matches
  || navigator.standalone === true
);

export async function enterFullscreen() {
  if (isFullscreen()) return true;
  const root = document.documentElement;
  try {
    if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
    else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
    else return false;
    return true;
  } catch { return false; }
}

export function setupTabletFullscreen() {
  const panel = document.createElement('aside');
  panel.className = 'fullscreen-tools';
  panel.innerHTML = `<button id="tablet-fullscreen" type="button" aria-label="Activar pantalla completa">⛶ Pantalla completa</button><p id="fullscreen-help" role="status" hidden></p>`;
  document.body.append(panel);
  const button = panel.querySelector('button');
  const help = panel.querySelector('p');
  const update = () => { panel.hidden = isFullscreen(); };
  button.onclick = async () => {
    const entered = await enterFullscreen();
    if (!entered) {
      help.textContent = 'El navegador no permitió pantalla completa. Abre este enlace en el navegador de la tableta, fuera del lector QR. Si no es compatible, prueba abrirlo desde un acceso añadido a la pantalla de inicio.';
      help.hidden = false;
    } else help.hidden = true;
    update();
  };
  document.addEventListener('fullscreenchange', update);
  document.addEventListener('webkitfullscreenchange', update);
  window.addEventListener('pageshow', update);
  update();
}

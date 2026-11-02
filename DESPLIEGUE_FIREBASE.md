# Publicar este proyecto en su propio repositorio y sitio Netlify

Proyecto: **Operational Evidence Analysis**. Identificador fijo: **bid-09**.
Firebase ya configurado: **f1-sap**. Destino: `bidProjects/bid-09/sessions/{sessionId}/events/{eventId}`.
Sitio de este proyecto: **https://bid-operational-evidence-analysis.netlify.app/**
Reporte: **https://bid-operational-evidence-analysis.netlify.app/analytics/report.html**
Dominio que debes agregar en Authentication: **bid-operational-evidence-analysis.netlify.app**.
Este repositorio funciona por separado de los otros 11; no necesita archivos de la carpeta general BID.

1. Copia los cambios en la raíz de SU repositorio GitHub, junto a `index.html`. Conserva `Images/` y los demás archivos existentes. En el ZIP, utiliza únicamente la subcarpeta correspondiente a este proyecto; no subas la carpeta contenedora de los 12 como si fuera un sitio.
2. Incluye `index.html`, el reproductor, `public/analytics/`, `scripts/`, `netlify.toml` y esta guía. Realiza commit y push a la rama de producción conectada en Netlify.
3. Netlify usa el comando **`npm run build:netlify`** y publica **`dist`**. Si el repositorio empieza directamente con `index.html`, deja la base directory vacía. Conserva las rutas de pantalla/control ya incluidas si este proyecto las utiliza. La validación local opcional se ejecuta con `node scripts/validate-firebase.mjs`.
4. Como el video usa Git LFS, verifica en Netlify → configuración del proyecto → variables de entorno: **`GIT_LFS_ENABLED=true`** y **`GIT_LFS_FETCH_INCLUDE=*.mp4`** (incluye cualquier otra extensión LFS que ya necesites). Estas variables se configuran en Netlify, no en `netlify.toml`, porque se usan al descargar el repositorio. El video real debe existir en Git LFS; el ZIP de actualización no contiene videos.
5. Una sola vez para el Firebase compartido: publica **`firestore.f1-sap.rules`** en Firestore → Reglas. Conserva la exclusión de `bidProjects` en la regla para las colecciones anteriores. Esas otras colecciones mantienen su acceso público existente. El push de GitHub no publica las reglas.
6. En Authentication, activa Anónimo y agrega el dominio de este sitio en Dominios autorizados. Repite el dominio para cada uno de los 12 sitios. La configuración pública ya está en `public/analytics/config.js`; no requiere variables Firebase en Netlify.
   En los proyectos que compilan, `SECRETS_SCAN_OMIT_PATHS` excluye solamente los dos archivos de configuración web pública de Firebase. Mantén el escaneo del resto del sitio habilitado.
7. Cuando Netlify indique Published, abre tu enlace habitual y realiza una sesión. Luego visita **`https://bid-operational-evidence-analysis.netlify.app/analytics/report.html`** desde el mismo navegador. Pulsa Sincronizar pendientes: debe indicar `Firebase: synced` y cero pendientes.
8. Comprueba en Firebase Console → Firestore → Datos → `bidProjects` → `bid-09` → `sessions`. Al volver a la portada y entrar otra vez, debe aparecer una sesión nueva.

Se registran pausas, reproducción, avances, retrocesos, reinicios y tramos reproducidos. Primero se guardan localmente y se reintentan envíos al recuperar internet. Cada dominio tiene su propia cola local; los datos centrales se separan por ID de proyecto en Firebase.

## Controles y video

Los controles y la barra se ocultan después de 2 segundos sin interacción y reaparecen al tocar el fondo. Permanecen visibles durante las instrucciones y mientras mantienes pulsado un botón o arrastras la barra. Los saltos rápidos acumulan su desplazamiento y agrupan las solicitudes al decodificador.

La primera apertura prepara el video completo y muestra su progreso. Después se reproduce desde una copia local, y se conserva en la caché del navegador cuando hay espacio. Los videos grandes se guardan en fragmentos; cada nueva versión tiene una huella SHA-256 distinta, de modo que no se reutilice un video anterior. Si el navegador rechaza el almacenamiento, la copia completa sigue disponible durante esa visita; cerrar la pestaña puede requerir descargarla otra vez. La caché del video no guarda el sitio completo para abrirlo sin internet desde cero.

Al reemplazar `Images/Video.mp4`, ejecuta **`node scripts/update-video.mjs`** y sube también `public/playback/media.js` junto al video usando Git LFS. Los proyectos con compilación también regeneran esa versión automáticamente durante el build de Netlify.

El reporte muestra datos locales o JSON importados. Firebase Console permite consultar lo recibido desde otros equipos. Netlify publica los cambios de la rama de producción de este repositorio; las reglas de Firestore se administran por separado en Firebase.

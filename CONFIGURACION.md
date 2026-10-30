# Reproductor local — IDB Group

El proyecto admite dos modalidades: servidor local sin internet y despliegue estático en Netlify con pantalla y control en dos ventanas de la misma computadora. Funciona con un solo monitor y mouse o con pantalla touch y televisión HDMI. No comprueba ni exige que Windows esté en modo Extender. Los recursos visuales originales permanecen intactos.

## Netlify: dos ventanas de la misma computadora

El archivo `netlify.toml` configura `npm run build:netlify` y publica `dist`. Esta compilación incluye el video real como `/local-video.mp4`, las rutas `/pantalla`, `/control` y `/tablet`, y la comunicación entre ventanas mediante BroadcastChannel. No necesita un servidor WebSocket.

1. Conectar el repositorio de esta experiencia a Netlify y desplegar la rama `main`.
2. Para descargar el video de Git LFS durante el checkout, configurar `GIT_LFS_ENABLED=true` en las variables de entorno de Netlify. No se configura en `netlify.toml` porque Netlify clona el repositorio antes de leer ese archivo. Si el checkout entrega un puntero, la compilación intenta `git lfs pull` y se detiene con un mensaje si no consigue el archivo real.
3. Abrir el sitio, pulsar **Abrir televisión**, luego **Abrir control táctil**, y activar la pantalla desde su ventana.
4. Usar el mismo navegador, perfil y dominio en ambas ventanas. Permitir las ventanas emergentes. No combinar una ventana privada con una normal.

Esta modalidad necesita internet para descargar la página y el video; no conecta dispositivos separados. Al recargar la pantalla, el control se vuelve a vincular y hay que activar el video de nuevo. Las opciones de QR para otro dispositivo se muestran únicamente en la modalidad de servidor local.

Para una subida manual a Netlify, ejecutar `npm run build:netlify` y subir **la carpeta `dist` completa**, incluido `_redirects` y `local-video.mp4`. `npm run build` conserva la compilación para el servidor local.

Prueba del despliegue estático: `npm run test:netlify`. Cubre rutas, video, reproducción, controles y reconexión sin un servidor de aplicación.

## Iniciar en Windows

1. Instalar Node.js 22 o superior (la instalación inicial de dependencias requiere internet).
2. Abrir `Iniciar_Totem.bat` y mantener esa ventana abierta.
3. Abrir **http://localhost:5173**, elegir **Abrir televisión**. Se abre una ventana del video.
4. En la página de inicio elegir **Abrir control táctil** cuando se habilite. Se abre otra ventana vinculada automáticamente, sin QR. También se puede abrir desde la preparación de la televisión.
5. En la ventana del video pulsar **Activar pantalla** para habilitar el audio.
6. Acomodar las dos ventanas lado a lado para probar con un monitor. Tocar o hacer clic en Inicio del control para comenzar. La pantalla completa no se activa automáticamente.
7. Con televisión disponible, usar Windows en **Extender** y arrastrar la ventana del video a la televisión; dejar el control en la pantalla touch. Activar pantalla completa manualmente en cada ventana si se desea. No es necesario conectar la televisión para usar la aplicación.

Si el navegador bloquea una ventana, permitir ventanas emergentes de este sitio y volver a pulsar el botón. Usar el mismo navegador, perfil y dirección (`localhost:5173`) en ambas ventanas para la vinculación automática. Si se recarga la televisión, el control abierto en `/control` se vincula a la nueva sesión automáticamente. Solo usar una ventana de televisión activa por experiencia.

### Otro dispositivo (opcional)

Se conserva el QR dentro de **Conectar otro dispositivo (opcional)** en la preparación de la televisión. Para este caso solamente, conectar ambos dispositivos a la misma red y elegir la dirección IP de la computadora en el desplegable antes de escanearlo. `localhost` es para el mismo computador.

Si Windows solicita acceso de red para Node.js, permitirlo en la red privada del evento. La red del banco debe permitir comunicación entre dispositivos y acceso al puerto TCP 5173 de la computadora. Algunas redes de invitados aíslan dispositivos incluso teniendo internet; en ese caso coordinar con TI una red permitida o un router dedicado.

## Comportamiento

### Pantalla completa en la tableta

La pantalla completa se activa únicamente mediante el botón **Pantalla completa** en la esquina superior izquierda del control: funciona incluso antes de activar el video, desaparece al entrar en pantalla completa y reaparece si se sale de ese modo. En la televisión, el botón está en su panel de preparación, accesible desde el engrane. También se puede usar F11. Se incluye compatibilidad con la API prefijada de WebKit.

El navegador exige un toque del usuario y puede rechazar la solicitud; la página no puede impedir que el usuario salga. Si abres el QR en un visor integrado, abre el enlace en el navegador de la tableta. En dispositivos sin soporte, el botón muestra una explicación. Prueba un acceso añadido a la pantalla de inicio según las opciones del dispositivo; no se garantiza el modo sin barras en todos los navegadores.

- Inicio: `Inicio_Pantalla.png` en la pantalla y `Inicio_Tablet.png` en la tableta.
- Tocar inicio: abre el controlador y muestra el video pausado en el segundo 1 (fotograma de introducción). En la tableta aparece Indicaciones centrado durante 6 segundos, mientras los controles y la barra pulsan suavemente. Al desaparecer las indicaciones, la tableta confirma a la pantalla que puede reproducir desde ese punto. Durante la introducción solo Back está disponible; evita adelantar el inicio por accidente. Si se pierde la conexión, la pantalla permanece pausada hasta recibir la confirmación al reconectar. Recargar la tableta durante la introducción vuelve a mostrar las indicaciones completas.
- Reboot: vuelve al segundo cero y reproduce inmediatamente, incluso si estaba pausado.
- −10 / +10: retrocede o avanza diez segundos, manteniendo pausa/reproducción. Los límites son cero y la duración del video.
- Play / Pause: alterna reproducción y pausa; el estado lo confirma la computadora.
- Barra: permite buscar un momento preciso; muestra tiempo y duración reales.
- Back y final del video: vuelven al inicio en ambos dispositivos. Buscar hasta el final también vuelve al inicio.
- Sin conexión: se deshabilitan controles, no se guardan órdenes para ejecutarlas después. Al reconectar se recibe el estado real. El video local sigue reproduciéndose aunque se desconecte la tableta.

Para volver a ver el QR, mover el mouse a la esquina inferior derecha y pulsar el engrane. El botón también es accesible con Tab. No es necesario reactivar el video al cerrar ese panel: usar **Volver a la pantalla**.

Cada pantalla crea su propia sesión y enlace aleatorio. Al recargar la televisión, el control de la misma computadora en `/control` se vincula automáticamente a la nueva sesión. Un dispositivo externo con el enlace `/tablet` debe escanear el nuevo QR. Las sesiones caducan después de 12 horas; para una jornada más larga, recargar la televisión y activarla otra vez.

## Preparación del evento

- Usar una sola ventana Televisión y una ventana Control táctil. Para pruebas basta un monitor; para el evento se puede conectar la televisión por HDMI o DisplayPort y extender el escritorio.
- Probar Play, Pause, Reboot, ±10, barra, Back y final de video en la red real.
- Desactivar suspensión de la computadora y bloqueo automático de la tableta durante el evento. El bloqueo de pantalla activa no está disponible en todos los navegadores sobre HTTP local.
- Mantener la computadora conectada a corriente y el proceso servidor abierto.
- Si el video no reproduce, comprobar que `Images/Video.mp4` existe y es compatible con el navegador. Se recomienda Chrome o Edge actualizado en la computadora; probar Safari en el iPad concreto.
- El enlace QR permite controlar su pantalla: compartirlo solo con el operador. Esta versión usa HTTP y está diseñada para una red local de confianza; no exponer el puerto a internet.

## Comandos para desarrollo

```powershell
npm.cmd ci
npm.cmd run dev
```

Modo del evento, con archivos compilados:

```powershell
npm.cmd run build
npm.cmd start
```

Pruebas:

```powershell
npm.cmd test
npm.cmd run test:e2e
```

Las pruebas de navegador requieren Chromium disponible para Playwright o Google Chrome instalado. La configuración utiliza Chrome del sistema cuando está presente.

## Alcance de esta entrega

En la modalidad local, el servidor gestiona el video y la conexión WebSocket, y permite un dispositivo de control en la misma red. En Netlify se utiliza la compilación específica descrita arriba, que incluye el video y comunica ventanas del mismo navegador. Conectar una tablet separada al despliegue público requiere un servicio de comunicación adicional.

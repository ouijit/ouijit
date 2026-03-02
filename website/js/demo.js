/* Ouijit Website — rrweb demo player
 *
 * Tries to load assets/recording.json and play it back.
 * If the file doesn't exist, the GIF fallback stays visible.
 */

(async function () {
  var RECORDING = 'assets/recording.json';
  var PLAYER_CSS = 'https://cdn.jsdelivr.net/npm/rrweb-player@2.0.0-alpha.20/dist/style.css';
  var PLAYER_JS = 'https://cdn.jsdelivr.net/npm/rrweb-player@2.0.0-alpha.20/dist/rrweb-player.umd.cjs';

  var container = document.getElementById('app-demo');
  var fallback = document.getElementById('demo-fallback');
  if (!container || !fallback) return;

  try {
    console.log('[demo] fetching recording...');
    var r = await fetch(RECORDING);
    if (!r.ok) { console.log('[demo] recording fetch failed:', r.status); return; }
    var events = await r.json();
    console.log('[demo] recording loaded:', events.length, 'events');
    if (!events || !events.length) { console.log('[demo] no events'); return; }

    // Load player CSS
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = PLAYER_CSS;
    document.head.appendChild(link);
    console.log('[demo] CSS loaded');

    // Load player JS via fetch+eval (.cjs MIME type blocked by script tag)
    console.log('[demo] fetching player JS...');
    var jsRes = await fetch(PLAYER_JS);
    var jsCode = await jsRes.text();
    console.log('[demo] player JS fetched:', jsCode.length, 'chars');
    new Function(jsCode).call(window);
    console.log('[demo] player JS eval done, rrwebPlayer:', typeof window.rrwebPlayer, Object.keys(window.rrwebPlayer));
    var Player = window.rrwebPlayer.default || window.rrwebPlayer;
    console.log('[demo] Player constructor:', typeof Player);

    fallback.style.display = 'none';

    // Use the recording's native dimensions
    var meta = events.find(function (e) { return e.type === 4; });
    var recW = meta ? meta.data.width : 1088;
    var recH = meta ? meta.data.height : 989;

    // Render at native size, CSS transform scales it down
    var player = new Player({
      target: container,
      props: {
        events: events,
        autoPlay: true,
        showController: false,
        width: recW,
        height: recH,
      },
    });

    // Scale to fit container and set correct height
    function scalePlayer() {
      var rr = container.querySelector('.rr-player');
      if (!rr) return;
      var scale = container.offsetWidth / recW;
      rr.style.transformOrigin = 'top left';
      rr.style.transform = 'scale(' + scale + ')';
      container.style.height = Math.round(recH * scale) + 'px';
    }
    scalePlayer();
    window.addEventListener('resize', scalePlayer);

    console.log('[demo] player created, native:', recW, 'x', recH);

    // Loop: restart when finished
    player.addEventListener('finish', function () {
      setTimeout(function () { player.goto(0, true); }, 1000);
    });
  } catch (e) {
    console.error('[demo] error:', e);
    // Show fallback again if it was hidden
    if (fallback) fallback.style.display = '';
  }
})();

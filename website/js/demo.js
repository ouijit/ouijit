/* Ouijit Website — rrweb demo player
 *
 * Loads assets/recording.json and plays it back.
 */

(async function () {
  var RECORDING = 'assets/recording.json';
  var PLAYER_CSS = 'https://cdn.jsdelivr.net/npm/rrweb-player@2.0.0-alpha.20/dist/style.css';
  var PLAYER_JS = 'https://cdn.jsdelivr.net/npm/rrweb-player@2.0.0-alpha.20/dist/rrweb-player.umd.cjs';

  var container = document.getElementById('app-demo');
  if (!container) return;

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

    // Override rrweb's default dot cursor with a macOS-style arrow
    var cursorSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='22'%3E%3Cpath d='M1.5 1v17.3l4.2-4.2h2.2L5.4 20l3 1.1 2.6-6.3h4.5L1.5 1z' fill='%23fff' stroke='%23000' stroke-width='1.2' stroke-linejoin='round'/%3E%3C/svg%3E";
    var cursorStyle = document.createElement('style');
    cursorStyle.textContent =
      '.replayer-mouse {' +
      '  background: none !important;' +
      '  border: none !important;' +
      '  border-radius: 0 !important;' +
      '  width: 16px !important;' +
      '  height: 22px !important;' +
      '  background-image: url("' + cursorSvg + '") !important;' +
      '  background-size: 16px 22px !important;' +
      '  background-repeat: no-repeat !important;' +
      '}' +
      '.replayer-mouse::after { display: none !important; }';
    document.head.appendChild(cursorStyle);

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
        insertStyleRules: [
          'html, body, .replayer-wrapper { background: #1C1C1E !important; }',
        ],
        mouseTail: false,
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
  }
})();

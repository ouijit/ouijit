/* Ouijit Website — rrweb demo player
 *
 * Loads assets/recording.json and plays it back.
 */

(function () {
  // Skip on mobile — no point loading a 3MB desktop demo on a phone
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;

  var container = document.getElementById('app-demo');
  if (!container) return;

  // Lazy-load: only fetch recording when demo section is near viewport
  var observer = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) {
      observer.disconnect();
      loadDemo();
    }
  }, { rootMargin: '200px' });
  observer.observe(container);

  function loadDemo() {
    fetch('assets/recording.json')
      .then(function (r) {
        if (!r.ok) throw new Error('Recording fetch failed: ' + r.status);
        return r.json();
      })
      .then(function (events) {
        if (!events || !events.length) return;

        // Extract native dimensions from metadata event
        var recW = 1088, recH = 989;
        for (var i = 0; i < events.length; i++) {
          if (events[i].type === 4 && events[i].data && events[i].data.width) {
            recW = events[i].data.width;
            recH = events[i].data.height;
            break;
          }
        }

        var Player = window.rrwebPlayer && window.rrwebPlayer.default
          ? window.rrwebPlayer.default
          : (typeof rrwebPlayer !== 'undefined' ? rrwebPlayer : null);
        if (!Player) {
          console.error('[demo] rrweb player not found');
          return;
        }

        // Override rrweb's default dot cursor with a macOS-style arrow
        var cursorSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='23'%3E%3Cpath d='M1.5 1.5l0 19 4.6-4.6 3 6.9 2.5-1-3-6.9H14.5L1.5 1.5z' fill='%23000' stroke='%23fff' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E";
        var cursorStyle = document.createElement('style');
        cursorStyle.textContent =
          '.replayer-mouse {' +
          '  background: none !important;' +
          '  border: none !important;' +
          '  border-radius: 0 !important;' +
          '  width: 16px !important;' +
          '  height: 23px !important;' +
          '  background-image: url("' + cursorSvg + '") !important;' +
          '  background-size: 16px 23px !important;' +
          '  background-repeat: no-repeat !important;' +
          '}' +
          '.replayer-mouse::after { display: none !important; }';
        document.head.appendChild(cursorStyle);

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

        var resizeRaf = 0;
        window.addEventListener('resize', function () {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(scalePlayer);
        });

        // Loop: restart when finished (dedup guard)
        var restartTimer = null;
        player.addEventListener('finish', function () {
          clearTimeout(restartTimer);
          restartTimer = setTimeout(function () { player.goto(0, true); }, 1000);
        });
      })
      .catch(function (err) {
        console.error('[demo] failed to load:', err);
      });
  }
})();

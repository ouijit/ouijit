/* Ouijit Website — rrweb demo player
 *
 * Loads assets/recording.json and plays it back.
 */

(function () {
  // Skip on mobile — no point loading a 3MB desktop demo on a phone
  if (window.matchMedia('(hover: none) and (pointer: coarse)').matches) return;

  const container = document.getElementById('app-demo');
  if (!container) return;

  // Lazy-load: only fetch recording when demo section is near viewport
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      observer.disconnect();
      loadDemo();
    }
  }, { rootMargin: '200px' });
  observer.observe(container);

  function loadDemo() {
    fetch('assets/recording.json')
      .then((r) => {
        if (!r.ok) throw new Error('Recording fetch failed: ' + r.status);
        return r.json();
      })
      .then((events) => {
        if (!events || !events.length) return;

        // Extract native dimensions from metadata event
        let recW = 1088, recH = 989;
        for (let i = 0; i < events.length; i++) {
          if (events[i].type === 4 && events[i].data && events[i].data.width) {
            recW = events[i].data.width;
            recH = events[i].data.height;
            break;
          }
        }

        const Player = window.rrwebPlayer && window.rrwebPlayer.default
          ? window.rrwebPlayer.default
          : (typeof rrwebPlayer !== 'undefined' ? rrwebPlayer : null);
        if (!Player) {
          console.error('[demo] rrweb player not found');
          return;
        }

        // Override rrweb's default dot cursor with a macOS-style arrow
        const cursorSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='23'%3E%3Cpath d='M1.5 1.5l0 19 4.6-4.6 3 6.9 2.5-1-3-6.9H14.5L1.5 1.5z' fill='%23000' stroke='%23fff' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E";
        const cursorStyle = document.createElement('style');
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
          '  transition: left 100ms linear, top 100ms linear, opacity 0.15s ease !important;' +
          '  opacity: 0;' +
          '}' +
          '.replayer-mouse::after { display: none !important; }' +
          '.click-pulse {' +
          '  position: absolute;' +
          '  width: 16px; height: 16px;' +
          '  margin-left: -8px; margin-top: -8px;' +
          '  border-radius: 50%;' +
          '  border: 2px solid rgba(255, 255, 255, 0.6);' +
          '  pointer-events: none;' +
          '  animation: click-pulse-anim 0.4s ease-out forwards;' +
          '}' +
          '@keyframes click-pulse-anim {' +
          '  0% { transform: scale(0.5); opacity: 1; }' +
          '  100% { transform: scale(2); opacity: 0; }' +
          '}';
        document.head.appendChild(cursorStyle);

        // Render at native size, CSS transform scales it down
        const player = new Player({
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
        const trafficLights = container.querySelector('.demo-traffic-lights');
        function scalePlayer() {
          const rr = container.querySelector('.rr-player');
          if (!rr) return;
          const scale = container.offsetWidth / recW;
          rr.style.transformOrigin = 'top left';
          rr.style.transform = 'scale(' + scale + ')';
          container.style.height = Math.round(recH * scale) + 'px';
          if (trafficLights) {
            trafficLights.style.transform = 'scale(' + scale + ') translate(18px, 18px)';
          }
        }
        scalePlayer();

        let resizeRaf = 0;
        window.addEventListener('resize', () => {
          cancelAnimationFrame(resizeRaf);
          resizeRaf = requestAnimationFrame(scalePlayer);
        });

        // Show cursor once it first moves away from (0,0)
        const mouseEl = container.querySelector('.replayer-mouse');
        if (mouseEl) {
          const showObserver = new MutationObserver(() => {
            if (parseFloat(mouseEl.style.left) > 0 || parseFloat(mouseEl.style.top) > 0) {
              mouseEl.style.opacity = '1';
              showObserver.disconnect();
            }
          });
          showObserver.observe(mouseEl, { attributes: true, attributeFilter: ['style'] });
        }

        // Click pulse: watch for mouse click class changes on the cursor
        const wrapper = container.querySelector('.replayer-wrapper');
        if (wrapper && mouseEl) {
          const clickObserver = new MutationObserver(() => {
            if (mouseEl.classList.contains('active')) {
              const pulse = document.createElement('div');
              pulse.className = 'click-pulse';
              pulse.style.left = mouseEl.style.left;
              pulse.style.top = mouseEl.style.top;
              wrapper.appendChild(pulse);
              pulse.addEventListener('animationend', () => { pulse.remove(); });
            }
          });
          clickObserver.observe(mouseEl, { attributes: true, attributeFilter: ['class'] });
        }

        // Loop: restart when finished (dedup guard)
        let restartTimer = null;
        player.addEventListener('finish', () => {
          clearTimeout(restartTimer);
          restartTimer = setTimeout(() => { player.goto(0, true); }, 1000);
        });
      })
      .catch((err) => {
        console.error('[demo] failed to load:', err);
      });
  }
})();

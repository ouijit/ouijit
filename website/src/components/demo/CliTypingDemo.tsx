import { Fragment, useState } from 'react';
import { useInView, useLoop } from './choreo';

interface Pair {
  ask: string;
  cmd: string;
  out: string;
  /** This command re-skins the terminal — the demo frame follows suit. */
  dracula?: boolean;
}

const PAIRS: Pair[] = [
  { ask: '# "file a task for the flaky login test"', cmd: 'ouijit task create "Fix flaky login test"', out: '→ created task T-23' },
  { ask: '# "run claude on every task I start"', cmd: `ouijit hook set start --command 'claude "$OUIJIT_TASK_DESCRIPTION"'`, out: '→ start hook saved' },
  { ask: '# "leave a review comment on PR 116"', cmd: 'ouijit pr draft add 116 --file src/api.ts --line 88', out: '→ staged · sends with your review' },
  { ask: '# "switch to dracula"', cmd: 'ouijit theme use dracula', out: '→ theme set', dracula: true },
];

const TYPE_MS = 16;

/**
 * A live shell looping the CLI's party tricks. The last command switches the
 * app theme, so the terminal it runs in switches too.
 */
export default function CliTypingDemo() {
  const [sceneRef, inView] = useInView<HTMLDivElement>(0.4);
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(0);
  const [shownOut, setShownOut] = useState(0);
  const [dracula, setDracula] = useState(false);

  useLoop(inView, (at) => {
    setStep(0);
    setTyped(0);
    setShownOut(0);
    setDracula(false);

    let t = 600;
    PAIRS.forEach((pair, i) => {
      at(t, () => {
        setStep(i);
        setTyped(0);
      });
      for (let c = 1; c <= pair.cmd.length; c++) {
        at(t + 260 + c * TYPE_MS, () => setTyped(c));
      }
      t += 260 + pair.cmd.length * TYPE_MS + 240;
      at(t, () => {
        setShownOut(i + 1);
        if (pair.dracula) setDracula(true);
      });
      t += 650;
    });
    return t + 2400;
  });

  return (
    <div ref={sceneRef} className="cli-demo" data-dracula={dracula || undefined}>
      <div className="cli-demo-titlebar">
        <span className="cli-demo-dot" />
        <span className="cli-demo-title">shell</span>
        <span className="cli-demo-meta">ouijit on PATH</span>
      </div>
      <div className="cli-demo-body">
        {PAIRS.map((pair, i) => {
          if (i > step) return null;
          const isCurrent = i === step;
          const cmdText = isCurrent ? pair.cmd.slice(0, typed) : pair.cmd;
          const outVisible = shownOut > i;
          return (
            <Fragment key={i}>
              <div className="cli-demo-ask">{pair.ask}</div>
              <div className="cli-demo-line">
                <span className="cli-demo-prompt">❯</span>
                <span className="cli-demo-cmd">
                  {cmdText}
                  {isCurrent && !outVisible && <span className="terminal-cursor" />}
                </span>
              </div>
              {outVisible && <div className="cli-demo-out">{pair.out}</div>}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

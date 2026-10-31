// @effect-diagnostics nodeBuiltinImport:off - Reads editability through the host's existing-only sidecar CLI.
import * as NodeChildProcess from "node:child_process";
import type { BetterWrightTarget } from "./BetterWrightBridge.ts";

export function betterWrightProbeCode(pageId: string, x: number, y: number): string {
  return `const origin = ${JSON.stringify({ x, y })};
let frame = await usePage(${JSON.stringify(pageId)});
let point = origin;
const hit = ({x,y}) => {
  let element = document.elementFromPoint(x,y);
  while (element && element.shadowRoot) {
    const inner = element.shadowRoot.elementFromPoint(x,y);
    if (!inner || inner === element) break;
    element = inner;
  }
  if (element && element.tagName === 'LABEL' && element.control) element = element.control;
  return element;
};
for (let depth = 0; depth < 8; depth++) {
  const handle = await frame.evaluateHandle(hit, point);
  try {
    const element = handle.asElement();
    if (!element) return false;
    const details = await element.evaluate(element => ({
      frame: element.tagName === 'IFRAME' || element.tagName === 'FRAME',
      left: element.clientLeft, top: element.clientTop,
      editable: !element.disabled && !element.readOnly && (element.isContentEditable ||
        element.tagName === 'TEXTAREA' || (element.tagName === 'INPUT' &&
          !['button','checkbox','radio','submit','reset','file','range','color','hidden','image'].includes(element.type)))
    }));
    if (!details.frame) return Boolean(details.editable);
    const child = await element.contentFrame();
    const box = await element.boundingBox();
    if (!child || !box) return false;
    frame = child;
    point = {x:origin.x - box.x - details.left,y:origin.y - box.y - details.top};
  } finally { await handle.dispose(); }
}
return false;`;
}

export function probeBetterWright(command: ReadonlyArray<string>, target: BetterWrightTarget,
  x: number, y: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    NodeChildProcess.execFile(command[0]!, [...command.slice(1), "--session", target.session,
      ...(target.profile ? ["--profile", target.profile] : []), "-c", betterWrightProbeCode(target.pageId, x, y)],
    { signal, timeout: 4000, maxBuffer: 65_536 }, (error, stdout) => {
      if (error) { resolve(false); return; }
      try {
        const response: unknown = JSON.parse(stdout);
        resolve(typeof response === "object" && response !== null && "ok" in response && response.ok === true && "result" in response && response.result === true);
      } catch { resolve(false); }
    });
  });
}

// tools/dev/text-scale.mjs — large-font (Android "Large", 130%) rows for the layout harnesses.
//
// Gonzalo's rule: every build is tested at 360-412dp with large fonts (130%). viewport-check
// and space-check append LARGE_FONT_SIZES to their default matrix.
//
// How 130% is emulated, and why this way:
// - Chrome on Android feeds the OS font size into Blink's accessibility font scale factor,
//   which enlarges TEXT and leaves the CSS viewport and px box sizes alone. (Chrome's newer
//   Accessibility Page Zoom can also fold the OS font size into page zoom, but that OS-level
//   adjustment ships default-off; WebView's textZoom uses the same font scale factor.)
// - That factor cannot be driven from desktop Chromium: it is only read on Android builds
//   (--blink-settings=accessibilityFontScaleFactor=1.3 measured identical text rects at 1.0
//   and 1.3), and CDP has no text-zoom command. Page.setFontSizes only changes the `medium`
//   default, which this game overrides with `html, body { font-size: 15px }`, so it does nothing.
// - So the harness scales the root: the html and body font-size the stylesheet resolved, x1.3
//   (15px -> 19.5px). In web/style.css 160 of 162 font-size declarations are
//   rem / var(--fs-*) / clamp(rem), one is em and one is the 15px root itself, so every piece of
//   text grows by exactly 1.3 while px widths, px paddings and the 44px touch floor stay put.
//   That is the same "text bigger, boxes not" result as the Android factor, and the same
//   mechanism as Chrome 146+'s <meta name="text-scale" content="scale"> (root default font
//   size x OS scale).
// - Not emulated as page zoom: a 130% zoom of a 360x640 phone is a 277x492 CSS viewport, which
//   tests a narrower phone rather than larger text.
// - Anything sized in rem (not only text) grows too; on a device only text would. These rows
//   are therefore slightly stricter than a real phone, never laxer.
export const LARGE_TEXT_SCALE = 1.3;

// [width, height, label, textScale]. 360x780 and 412x915 are tall Android phones.
export const LARGE_FONT_SIZES = [
  [360, 640, 'phone-small-font130', LARGE_TEXT_SCALE],
  [360, 780, 'android-tall-font130', LARGE_TEXT_SCALE],
  [390, 844, 'iphone-14-font130', LARGE_TEXT_SCALE],
  [412, 915, 'galaxy-s25plus-font130', LARGE_TEXT_SCALE],
];

// Size key used by --sizes and the tables: "360x640" for 100% rows, "360x640@130" for 130%.
export const sizeKey = (w, h, scale = 1) => `${w}x${h}` + (scale === 1 ? '' : `@${Math.round(scale * 100)}`);

// Installed with Page.addScriptToEvaluateOnNewDocument for one large-font row (so it survives
// the harness's reloads) and removed after it. On load it multiplies the root and body font
// sizes the stylesheet resolved and records the factor on <html data-text-scale>.
export function textScaleScript(scale) {
  return `(() => {
    const S = ${Number(scale)};
    const apply = () => {
      const h = document.documentElement, b = document.body;
      if (!b || h.dataset.textScale) return;
      const fh = parseFloat(getComputedStyle(h).fontSize), fb = parseFloat(getComputedStyle(b).fontSize);
      h.style.setProperty('font-size', (fh * S) + 'px', 'important');
      b.style.setProperty('font-size', (fb * S) + 'px', 'important');
      h.dataset.textScale = String(S);
    };
    addEventListener('load', apply);
  })();`;
}

// Returns the script identifier (null for a 100% row).
export async function beginTextScale(S, scale) {
  if (scale === 1) return null;
  const r = await S('Page.addScriptToEvaluateOnNewDocument', { source: textScaleScript(scale) });
  return r.result.identifier;
}
export async function endTextScale(S, identifier) {
  if (identifier !== null) await S('Page.removeScriptToEvaluateOnNewDocument', { identifier });
}

// The page's own record of the scale it rendered at, plus the resolved root size.
export const TEXT_SCALE_PROBE = `({ applied: Number(document.documentElement.dataset.textScale || 1), rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize) })`;

// A large-font row whose page did not render at that scale is a broken row, not a pass.
export function textScaleFailure(m) {
  if (Math.abs((m.textScaleApplied ?? 1) - (m.textScale ?? 1)) > 1e-6) {
    return `TEXT SCALE NOT APPLIED: requested ${m.textScale}, page rendered at ${m.textScaleApplied} (root ${m.rootFontPx}px)`;
  }
  return null;
}

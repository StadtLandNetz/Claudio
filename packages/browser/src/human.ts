import type { Page } from "playwright";
import type { BrowserAttachment } from "./driver.js";

/**
 * Hands the browser to a person for a moment (CAPTCHA, bot check, 2FA prompt).
 * The worker implements it: it records the request, applies the person's clicks
 * and keystrokes, and resolves when they press "continue".
 */
export type HumanOutcome = "resolved" | "cancelled" | "timeout";
export type HumanBridge = { wait(reason: string): Promise<HumanOutcome> };
/** Created per run once the browser exists. */
export type HumanBridgeFactory = (attachment: BrowserAttachment) => HumanBridge;

/** Input a person sends from the live view. Coordinates are relative to the viewport (0..1). */
export type HumanInput =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; dy: number };

const ALLOWED_KEYS = new Set(["Enter", "Tab", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

export async function applyHumanInput(page: Page, input: HumanInput): Promise<void> {
  const vp = page.viewportSize() ?? (await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
  switch (input.type) {
    case "click":
      await page.mouse.click(Math.round(clamp01(input.x) * vp.width), Math.round(clamp01(input.y) * vp.height));
      return;
    case "type":
      await page.keyboard.type(input.text.slice(0, 500), { delay: 30 });
      return;
    case "key":
      if (ALLOWED_KEYS.has(input.key)) await page.keyboard.press(input.key === "Space" ? " " : input.key);
      return;
    case "scroll":
      await page.mouse.wheel(0, Math.max(-2000, Math.min(2000, input.dy)));
      return;
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

const CAPTCHA_FRAMES = [
  { pattern: /google\.com\/recaptcha|recaptcha\.net|\/recaptcha\/api2\//i, name: "reCAPTCHA" },
  { pattern: /hcaptcha\.com/i, name: "hCaptcha" },
  { pattern: /challenges\.cloudflare\.com/i, name: "Cloudflare Turnstile" },
  { pattern: /arkoselabs\.com|funcaptcha/i, name: "Arkose/FunCaptcha" },
];

const CAPTCHA_TEXT = [
  /i'?m not a robot/i,
  /ich bin kein roboter/i,
  /unusual traffic from your computer/i,
  /ungewöhnliche[nr]? (daten)?verkehr/i,
  /verify (that )?you are (a )?human/i,
  /bestätigen sie, dass sie ein mensch sind/i,
  /checking if the site connection is secure/i,
];

/**
 * Recognises a CAPTCHA or bot check on the current page. Returns a short
 * description, or null. Cheap enough to run after every browser action.
 */
export async function detectCaptcha(page: Page | undefined): Promise<string | null> {
  if (!page || page.isClosed()) return null;
  try {
    const url = page.url();
    if (/google\.[a-z.]+\/sorry\//i.test(url)) return "Google-Bot-Prüfung (ungewöhnlicher Datenverkehr)";
    for (const frame of page.frames()) {
      const hit = CAPTCHA_FRAMES.find((c) => c.pattern.test(frame.url()));
      if (hit) {
        // Invisible reCAPTCHA badges are everywhere; only count a visible challenge frame.
        const el = await frame.frameElement().catch(() => null);
        const box = el ? await el.boundingBox().catch(() => null) : null;
        if (box && box.width > 40 && box.height > 40) return `${hit.name} auf ${new URL(url).host}`;
      }
    }
    const text = await page.locator("body").innerText({ timeout: 1500 }).catch(() => "");
    const m = CAPTCHA_TEXT.find((re) => re.test(text.slice(0, 5000)));
    return m ? `Bot-Prüfung auf ${new URL(url).host}` : null;
  } catch {
    return null;
  }
}

import puppeteer, {
	type Browser,
	type PuppeteerLifeCycleEvent,
	type Page,
} from "puppeteer";
import { writeFile } from "node:fs/promises";
import type { ScreenshotOptions } from "./types";
import { PuppeteerBlocker } from "@cliqz/adblocker-puppeteer";
import fetch from "cross-fetch";

// Import and setup autoconsent rules
const autoconsent = require("@duckduckgo/autoconsent/dist/autoconsent.puppet.js");
const extraRules = require("@duckduckgo/autoconsent/rules/rules.json");

interface StickyStyle {
	element: Element;
	style: string;
}

declare global {
	interface Window {
		__originalStickyStyles: StickyStyle[];
	}
}

const log = console.log;
const warn = console.warn;

// PageManager is a utility class that handles page specific operations
// biome-ignore lint/complexity/noStaticOnlyClass: <explanation>
class PageManager {
	// handleStickyElements is a static method that modifies the styles of sticky elements
	private static async handleStickyElements(page: Page): Promise<void> {
		await page.evaluate(() => {
			const modifyStickyElements = (): StickyStyle[] => {
				const originalStyles: StickyStyle[] = [];
				const stickySelectors = [
					'[style*="position: fixed"]',
					'[style*="position:fixed"]',
					'[style*="position: sticky"]',
					'[style*="position:sticky"]',
				].join(", ");

				const stickyElements = new Set([
					...Array.from(
						document.querySelectorAll<HTMLElement>(stickySelectors),
					),
					...Array.from(document.querySelectorAll("*")).filter((element) => {
						const style = window.getComputedStyle(element);
						return style.position === "fixed" || style.position === "sticky";
					}),
				]);

				for (const element of stickyElements) {
					const htmlElement = element as HTMLElement;
					const computedStyle = window.getComputedStyle(htmlElement);
					if (
						computedStyle.position === "fixed" ||
						computedStyle.position === "sticky"
					) {
						originalStyles.push({
							element,
							style: htmlElement.style.cssText,
						});

						htmlElement.style.setProperty("position", "static", "important");

						if (
							element.tagName.toLowerCase() === "header" ||
							element.tagName.toLowerCase() === "nav" ||
							element.getAttribute("role") === "navigation"
						) {
							htmlElement.style.setProperty("top", "0", "important");
							htmlElement.style.setProperty("z-index", "auto", "important");
						}
					}
				}
				return originalStyles;
			};

			(window as Window).__originalStickyStyles = modifyStickyElements();
		});
	}

	// restoreStickyElements is a static method that restores the original styles of sticky elements
	private static async restoreStickyElements(page: Page): Promise<void> {
		await page.evaluate(() => {
			const originalStyles = (window as Window & typeof globalThis)
				.__originalStickyStyles as StickyStyle[];
			if (originalStyles) {
				for (const { element, style } of originalStyles) {
					(element as HTMLElement).style.cssText = style;
				}
			}
		});
	}

	// Add smooth scrolling method
	private static async smoothScroll(page: Page): Promise<void> {
		await page.evaluate(async () => {
			await new Promise<void>((resolve) => {
				let totalHeight = 0;
				const distance = 100; // Scroll by 100px each time
				const delay = 100; // Wait 100ms between scrolls

				const timer = setInterval(() => {
					const scrollHeight = document.body.scrollHeight;
					window.scrollBy(0, distance);
					totalHeight += distance;

					// If we've scrolled past the document height
					if (totalHeight >= scrollHeight) {
						// Scroll back to top
						window.scrollTo(0, 0);
						clearInterval(timer);
						// Wait a bit after scrolling back to top
						setTimeout(resolve, 500);
					}
				}, delay);
			});
		});
	}

	// blockChatWidgets is a static method that blocks chat widgets on the page by hiding them
	private static async blockChatWidgets(page: Page): Promise<void> {
		// Block chat widget requests
		const blockPatterns = [
			"crisp.chat",
			"intercom.io",
			"messenger.com",
			"facebook.com/*/customer_chat",
			"drift.com",
			"tawk.to",
			"user.com",
			"zoho.com/salesiq",
			"hubspot.com/messaging",
			"livechatinc.com",
			"zopim.com",
			"freshchat.com",
			"olark.com",
			"zendesk.com/embeddable",
			"gorgias.chat",
			"smooch.io",
			"purechat.com",
		];

		// Set up request interception without interfering with existing handlers
		await page.setRequestInterception(true);
		page.on("request", async (request) => {
			try {
				const url = request.url().toLowerCase();
				if (blockPatterns.some((pattern) => url.includes(pattern))) {
					await request.abort();
				} else {
					await request.continue();
				}
			} catch (error) {
				// If request is already handled, ignore the error
				if (
					error instanceof Error &&
					!error.message.includes("Request is already handled")
				) {
					warn("Request interception error:", error);
				}
				// Ensure the request doesn't hang
				try {
					await request.continue();
				} catch (e) {
					// Ignore any subsequent errors
				}
			}
		});

		// Add DOM-based blocking
		try {
			await page.evaluate(() => {
				const chatSelectors = [
					// Hubspot specific selectors
					"#hubspot-messages-iframe-container",
					'[class*="hubspot-messages"]',
					"[data-hubspot-mounted]",
					"[data-hs-messaging]",
					'iframe[src*="hubspot"]',
					'iframe[id*="hubspot"]',
					'div[class*="hs-message"]',
					"#hs-eu-cookie-confirmation",
					"#hs-banner-iframe",
					"#chat-widget-container",

					// Updated selectors for better coverage
					'[class*="chat-widget"]',
					'[class*="messenger"]',
					'[id*="chat-widget"]',
					'[id*="messenger"]',
					'div[class*="chat"]',
					'div[id*="chat"]',
					'iframe[title*="chat" i]',
					'iframe[title*="messenger" i]',
					'div[aria-label*="chat" i]',

					// Platform specific selectors
					"#crisp-chatbox",
					'[class*="crisp-client"]',
					'div[class*="crisp"]',
					"#intercom-container",
					"#intercom-frame",
					'[class*="intercom-"]',
					".fb-customerchat",
					'iframe[class*="fb_customer_chat"]',
					"#drift-widget",
					'[class*="drift-frame"]',
					"#tawk-tooltip",
					'iframe[title*="tawk"]',
					"#usercom-messenger",
					'[class*="usercom"]',
					"#zsiq_float",
					'[class*="zsiq"]',
					"#hubspot-messages-iframe-container",
					'[class*="hubspot-messages"]',

					// Common patterns
					'div[class*="widget-chat"]',
					'div[class*="chat-button"]',
					'div[class*="chat-launcher"]',
					'div[class*="live-chat"]',
					'div[class*="livechat"]',
					'[data-testid*="chat"]',
					'[role="dialog"][aria-label*="chat" i]',
				];

				// Function to remove chat elements
				const removeChatElements = () => {
					for (const selector of chatSelectors) {
						const elements = document.querySelectorAll(selector);
						for (const element of Array.from(elements)) {
							element.remove();
						}
					}
				};

				// Initial removal
				removeChatElements();

				// Create style to hide chat widgets
				const style = document.createElement("style");
				style.textContent = `
					${chatSelectors.join(", ")} {
						display: none !important;
						visibility: hidden !important;
						opacity: 0 !important;
						pointer-events: none !important;
						width: 0 !important;
						height: 0 !important;
						position: absolute !important;
						z-index: -9999 !important;
					}

					/* Block high z-index elements */
					iframe[style*="z-index:"][style*="999999"],
					iframe[style*="z-index: "][style*="999999"],
					div[style*="z-index:"][style*="999999"],
					div[style*="z-index: "][style*="999999"],
					/* Hubspot specific */
					.hs-default-font-element,
					.hs-shadow-container,
					#hubspot-messages-iframe-container,
					iframe[id^="hubspot-messages-iframe"],
					.hs-messages-iframe-wrapper {
						display: none !important;
						visibility: hidden !important;
						opacity: 0 !important;
					}
				`;
				document.head.appendChild(style);

				// Set up mutation observer
				const observer = new MutationObserver((mutations) => {
					let shouldRemove = false;
					for (const mutation of mutations) {
						if (mutation.addedNodes.length) {
							shouldRemove = true;
						}
					}
					if (shouldRemove) {
						removeChatElements();
					}
				});

				observer.observe(document.body, {
					childList: true,
					subtree: true,
					attributes: true,
				});

				// Return cleanup function
				return () => observer.disconnect();
			});
		} catch (error) {
			warn("Chat widget blocking error:", error);
		}
	}

	// setupPage is a static method that creates a new page with the specified options like width, height, and timeout
	static async setupPage(
		browser: Browser,
		options: ScreenshotOptions,
	): Promise<Page> {
		const page = await browser.newPage();
		await page.setViewport({
			width: options.width ?? 1920,
			height: options.height ?? 1080,
		});
		page.setDefaultTimeout(options.timeout ?? 30000);
		return page;
	}

	// navigateAndPrepare is a static method that navigates to the specified URL and prepares the page
	static async navigateAndPrepare(
		page: Page,
		url: string,
		rules: (typeof autoconsent.ConsentOMaticCMP)[],
		waitUntil: PuppeteerLifeCycleEvent,
		timeout: number,
	): Promise<void> {
		// Block chat widgets
		await PageManager.blockChatWidgets(page);

		page.once("load", async () => {
			try {
				// Attach the autoconsent CMP to the page and handle the consent dialog
				const tab = autoconsent.attachToPage(page, url, rules, 10);
				// Wait for the tab to be checked and do the opt-in
				await tab.checked;

				// Check if the tab has a rule and do the opt-in
				if (tab.rule) {
					await tab.doOptIn();
				} else {
					log("No consent rule found, continuing without consent handling");
				}
			} catch (error) {
				warn("CMP handling error:", error);
			}
		});

		// Navigate to the specified URL with the specified options
		await page.goto(url, { waitUntil, timeout });

		// Handle sticky elements
		await PageManager.handleStickyElements(page);

		// Wait for the page to load
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	// captureScreenshot is a static method that captures a screenshot of the page
	static async captureScreenshot(
		page: Page,
		options: ScreenshotOptions,
	): Promise<Buffer> {
		if (options.fullPage) {
			// Perform smooth scroll before taking screenshot
			await PageManager.smoothScroll(page);
			// Wait for any lazy-loaded content
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}

		const screenshot = await page.screenshot({
			fullPage: options.fullPage ?? true,
			type: options.format ?? "jpeg",
			quality: options.format === "jpeg" ? (options.quality ?? 80) : undefined,
		});

		await PageManager.restoreStickyElements(page);
		await page.close();

		return Buffer.from(screenshot);
	}
}

// ScreenshotService is a class that provides screenshot capturing functionality
export class ScreenshotService {
	private browser: Browser | null = null;
	private blocker: PuppeteerBlocker | null = null;
	private readonly rules: (typeof autoconsent.ConsentOMaticCMP)[];

	// Constructor initializes the ScreenshotService with the autoconsent rules
	constructor() {
		// Initialize the ScreenshotService with the autoconsent rules
		const consentomatic = extraRules.consentomatic;
		this.rules = [
			// Add the autoconsent rules
			...autoconsent.rules,
			// Map the consentomatic rules to the autoconsent CMP
			...Object.keys(consentomatic).map(
				(name) =>
					new autoconsent.ConsentOMaticCMP(`com_${name}`, consentomatic[name]),
			),
			// Map the extra rules to the autoconsent CMP
			...extraRules.autoconsent.map(
				(spec: { name: string; detectors: unknown[]; methods: unknown[] }) =>
					autoconsent.createAutoCMP(spec),
			),
		];
		this.initialize();
	}

	// Initialize the browser and blocker
	private async initialize(): Promise<void> {
		try {
			// block third-party cookies
			this.blocker = await PuppeteerBlocker.fromLists(fetch, [
				"https://secure.fanboy.co.nz/fanboy-cookiemonster.txt", // Fanboy's Cookiemonster list for blocking consent brokers
				// "https://raw.githubusercontent.com/easylist/easylist/master/easylist/easylist_general_block.txt", // Additional blocking rules
			]);

			// Launch the browser with the specified options
			this.browser = await puppeteer.launch({
				headless: true,
				args: [
					"--no-sandbox",
					"--disable-setuid-sandbox",
					"--disable-dev-shm-usage",
					"--disable-gpu",
				],
			});
		} catch (error) {
			console.error("Browser initialization failed:", error);
			throw new Error("Failed to initialize screenshot service");
		}
	}

	// Take a screenshot of the specified URL with the specified options
	async takeScreenshot(options: ScreenshotOptions): Promise<Buffer> {
		// 1. If the browser is not initialized, initialize it
		if (!this.browser) {
			await this.initialize();
		}

		if (!this.browser) {
			throw new Error("Browser initialization failed");
		}

		try {
			log(`Taking screenshot of ${options.url}...`);

			// 2. Setup the page with the specified options
			const page = await PageManager.setupPage(this.browser, options);

			// 3. If the blocker is initialized, enable blocking in the page
			if (this.blocker) {
				await this.blocker.enableBlockingInPage(page);
			}

			// 4. Navigate to the specified URL and prepare the page
			await PageManager.navigateAndPrepare(
				page,
				options.url,
				this.rules,
				(options.waitUntil as PuppeteerLifeCycleEvent) ?? "networkidle2",
				options.timeout ?? 30000,
			);

			// 5. Capture a screenshot of the page
			const screenshot = await PageManager.captureScreenshot(page, options);

			// 6. If the outputPath is specified, save the screenshot to the outputPath
			if (options.outputPath) {
				await writeFile(options.outputPath, new Uint8Array(screenshot));
				log(`Screenshot saved to ${options.outputPath}`);
			}

			// 7. Return the screenshot buffer
			return screenshot;
		} catch (error) {
			console.error(`Screenshot failed for ${options.url}:`, error);
			throw error;
		}
	}

	// Cleanup the browser and blocker
	async cleanup(): Promise<void> {
		if (this.browser) {
			await this.browser.close();
			this.browser = null;
		}
	}
}

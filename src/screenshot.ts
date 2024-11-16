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

interface ScrollMetrics {
	viewportHeight: number; // Height of visible area
	documentHeight: number; // Total page height
	scrollTop: number; // Current scroll position
}

interface LazyLoadMetrics {
	imageCount: number; // Number of images on page
	iframeCount: number; // Number of iframes
	pendingNetworkRequests: number; // Active network requests
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
			// Common chat services
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

			// HubSpot specific domains
			"js.hsforms.net",
			"js.usemessages.com",
			"js.hs-scripts.com",
			"js.hscollectedforms.net",
			"js.hsadspixel.net",
			"js.hs-analytics.net",
			"js.hs-banner.com",
			"*.hubspot.com/conversations-visitor",
			"meetings.hubspot.com",
			"api.hubspot.com/conversations",
			"*.hubspot.net",
		];

		// Set up request interception
		await page.setRequestInterception(true);
		page.on("request", async (request) => {
			try {
				const url = request.url().toLowerCase();
				if (
					blockPatterns.some((pattern) => {
						const regexPattern = pattern
							.replace(/\./g, "\\.")
							.replace(/\*/g, ".*");
						return new RegExp(regexPattern).test(url);
					})
				) {
					await request.abort();
				} else {
					await request.continue();
				}
			} catch (error) {
				if (
					error instanceof Error &&
					!error.message.includes("Request is already handled")
				) {
					console.warn("Request interception error:", error);
				}
				try {
					await request.continue();
				} catch (e) {
					// Ignore subsequent errors
				}
			}
		});

		// Add DOM-based blocking
		await page.evaluate(() => {
			const chatSelectors = {
				// HubSpot specific selectors
				hubspot: [
					// Iframe containers
					"#hubspot-messages-iframe-container",
					"iframe[data-test-id='hubspot-messages-iframe']",
					"iframe[data-test-id='chat-widget-iframe']",
					"iframe[id^='hubspot-messages-iframe']",
					".hs-messages-iframe-wrapper",
					"[data-hubspot-mounted='true']",
					"[data-hs-messages-widget]",
					"[data-hs-messaging]",
					".hs-messages-widget",
					".hs-messages",
					"[data-messaging-widget-loading]",
					".hs-widget-loading",
					".hs-default-font-element",
					".hs-shadow-container",
					"#hs-eu-cookie-confirmation",
					"#hs-banner-iframe",
					'[class*="hs-messenger"]',
					'[id*="hs-messenger"]',
					"#hs-script-container",
				],

				// General chat widget selectors
				general: [
					// Crisp
					"#crisp-chatbox",
					'[class*="crisp-client"]',
					'div[class*="crisp"]',

					// Intercom
					"#intercom-container",
					"#intercom-frame",
					'[class*="intercom-"]',

					// Facebook
					".fb-customerchat",
					'iframe[class*="fb_customer_chat"]',

					// Drift
					"#drift-widget",
					'[class*="drift-frame"]',

					// Tawk
					"#tawk-tooltip",
					'iframe[title*="tawk"]',

					// Others
					"#usercom-messenger",
					'[class*="usercom"]',
					"#zsiq_float",
					'[class*="zsiq"]',
					'div[class*="widget-chat"]',
					'div[class*="chat-button"]',
					'div[class*="chat-launcher"]',
					'div[class*="live-chat"]',
					'div[class*="livechat"]',
					'[data-testid*="chat"]',
					'[role="dialog"][aria-label*="chat" i]',
					'[class*="chat-widget"]',
					'[class*="messenger"]',
					'[id*="chat-widget"]',
					'[id*="messenger"]',
					'div[class*="chat"]',
					'div[id*="chat"]',
					'iframe[title*="chat" i]',
					'iframe[title*="messenger" i]',
					'div[aria-label*="chat" i]',
				],
			};

			// Combine all selectors
			const allSelectors = [...chatSelectors.hubspot, ...chatSelectors.general];

			// Function to remove chat elements with retry mechanism
			const removeChatElements = () => {
				for (const selector of allSelectors) {
					const elements = document.querySelectorAll(selector);
					for (const element of Array.from(elements)) {
						if (element instanceof HTMLElement) {
							try {
								// First try to remove
								element.remove();
							} catch (e) {
								// If removal fails, hide with CSS
								element.style.cssText = `
								display: none !important;
								visibility: hidden !important;
								opacity: 0 !important;
								pointer-events: none !important;
								width: 0 !important;
								height: 0 !important;
								position: absolute !important;
								z-index: -9999 !important;
								clip: rect(1px, 1px, 1px, 1px) !important;
								overflow: hidden !important;
								`;
							}
						}
					}
				}
			};

			// Initial removal
			removeChatElements();

			// Create and inject blocking styles
			const style = document.createElement("style");
			style.textContent = `
            /* HubSpot specific blocking */
            ${chatSelectors.hubspot.join(",\n            ")} {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
                width: 0 !important;
                height: 0 !important;
                position: absolute !important;
                z-index: -9999 !important;
                clip: rect(1px, 1px, 1px, 1px) !important;
                overflow: hidden !important;
            }

            /* Block high z-index elements */
            [style*="z-index:"][style*="999999"][id*="hubspot"],
            [style*="z-index:"][style*="999999"][class*="hs-"],
            iframe[style*="z-index:"][style*="999999"][src*="hubspot"],
            [style*="z-index:"][style*="999999"],
            [style*="z-index: "][style*="999999"] {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }

            /* General chat widget blocking */
            ${chatSelectors.general.join(",\n            ")} {
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }

            /* Prevent fixed position elements */
            [style*="position: fixed"],
            [style*="position:fixed"] {
                position: absolute !important;
            }
        `;
			document.head.appendChild(style);

			// Enhanced mutation observer
			const observer = new MutationObserver((mutations) => {
				let shouldRemove = false;
				for (const mutation of mutations) {
					// Check for added nodes
					if (mutation.addedNodes.length) {
						shouldRemove = true;
						break;
					}

					// Check for attribute changes on potential chat elements
					if (
						mutation.type === "attributes" &&
						mutation.target instanceof HTMLElement
					) {
						const targetElement = mutation.target;
						const hasHubspotClass =
							targetElement.className?.includes("hs-") ||
							targetElement.className?.includes("hubspot");
						const hasHubspotId =
							targetElement.id?.includes("hs-") ||
							targetElement.id?.includes("hubspot");
						const hasChatClass =
							targetElement.className?.toLowerCase().includes("chat") ||
							targetElement.className?.toLowerCase().includes("messenger");

						if (hasHubspotClass || hasHubspotId || hasChatClass) {
							shouldRemove = true;
							break;
						}
					}
				}

				if (shouldRemove) {
					removeChatElements();
					// Additional check after a short delay
					setTimeout(removeChatElements, 100);
				}
			});

			// Start observing with specific options
			observer.observe(document.body, {
				childList: true,
				subtree: true,
				attributes: true,
				attributeFilter: ["style", "class", "id"],
			});

			// Periodic cleanup for persistent widgets
			const cleanupInterval = setInterval(removeChatElements, 1000);

			// Return cleanup function
			return () => {
				observer.disconnect();
				clearInterval(cleanupInterval);
			};
		});
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

	private static async getScrollMetrics(page: Page): Promise<ScrollMetrics> {
		return page.evaluate(() => ({
			viewportHeight: window.innerHeight,
			documentHeight: Math.max(
				document.documentElement.scrollHeight,
				document.body.scrollHeight,
				document.documentElement.offsetHeight,
				document.body.offsetHeight,
			),
			scrollTop: window.scrollY,
		}));
	}

	private static async getLazyLoadMetrics(
		page: Page,
	): Promise<LazyLoadMetrics> {
		return page.evaluate(() => ({
			imageCount: document.images.length,
			iframeCount: document.getElementsByTagName("iframe").length,
			pendingNetworkRequests: window.performance
				.getEntriesByType("resource")
				.filter((r) => !(r as PerformanceResourceTiming).responseEnd).length,
		}));
	}

	private static async waitForLazyLoad(
		page: Page,
		timeout = 5000,
	): Promise<void> {
		const startTime = Date.now();
		let previousMetrics: LazyLoadMetrics | null = null;

		while (Date.now() - startTime < timeout) {
			const currentMetrics = await PageManager.getLazyLoadMetrics(page);

			// If this is our first check, store metrics and continue
			if (!previousMetrics) {
				previousMetrics = currentMetrics;
				await new Promise((resolve) => setTimeout(resolve, 100));
				continue;
			}

			// Check if content has stabilized by comparing:
			// 1. Number of images hasn't changed
			// 2. Number of iframes hasn't changed
			// 3. No pending network requests
			const isStable =
				currentMetrics.imageCount === previousMetrics.imageCount &&
				currentMetrics.iframeCount === previousMetrics.iframeCount &&
				currentMetrics.pendingNetworkRequests === 0;

			if (isStable) {
				// Double check stability after a short wait
				await new Promise((resolve) => setTimeout(resolve, 200));
				const finalCheck = await PageManager.getLazyLoadMetrics(page);

				if (
					finalCheck.imageCount === currentMetrics.imageCount &&
					finalCheck.iframeCount === currentMetrics.iframeCount &&
					finalCheck.pendingNetworkRequests === 0
				) {
					return; // Content has stabilized
				}
			}

			previousMetrics = currentMetrics;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		console.warn("Lazy load wait timeout reached");
	}

	private static async intelligentScroll(
		page: Page,
		options: {
			maxTimeout?: number; // Maximum time to spend scrolling
			scrollStep?: number; // How many pixels to scroll each time
			stabilityTimeout?: number; // How long to wait for content to stabilize
		} = {},
	): Promise<void> {
		const {
			maxTimeout = 30000,
			scrollStep = 250,
			stabilityTimeout = 5000,
		} = options;

		const startTime = Date.now();
		let lastDocumentHeight = 0;
		let stabilityCounter = 0;
		const STABILITY_THRESHOLD = 3; // Number of checks before considering page stable

		while (Date.now() - startTime < maxTimeout) {
			// Get current scroll position and page dimensions
			const metrics = await PageManager.getScrollMetrics(page);

			// Check if we've reached the bottom
			if (
				metrics.scrollTop + metrics.viewportHeight >=
				metrics.documentHeight
			) {
				break;
			}

			// Check for document height stability
			if (metrics.documentHeight === lastDocumentHeight) {
				stabilityCounter++;
				if (stabilityCounter >= STABILITY_THRESHOLD) {
					// Page height hasn't changed for 3 checks
					break;
				}
			} else {
				stabilityCounter = 0;
				lastDocumentHeight = metrics.documentHeight;
			}

			// Scroll and wait for content
			await page.evaluate((step) => {
				window.scrollBy(0, step);
			}, scrollStep);

			// Wait for lazy loading to stabilize
			await PageManager.waitForLazyLoad(page, stabilityTimeout);

			// Check for new dynamic content
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		// Scroll back to top
		await page.evaluate(() => {
			window.scrollTo(0, 0);
		});

		// Final wait for any animations or transitions
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	// captureScreenshot is a static method that captures a screenshot of the page
	static async captureScreenshot(
		page: Page,
		options: ScreenshotOptions,
	): Promise<Buffer> {
		if (options.fullPage) {
			// Get initial metrics to determine page size
			const initialMetrics = await PageManager.getScrollMetrics(page);

			// Adjust timeout based on page length
			const baseTimeout = options.timeout ?? 30000;
			const adjustedTimeout = Math.min(
				baseTimeout *
					Math.ceil(
						initialMetrics.documentHeight / initialMetrics.viewportHeight,
					),
				120000, // Max 2 minutes
			);

			// Perform intelligent scrolling
			await PageManager.intelligentScroll(page, {
				maxTimeout: adjustedTimeout,
				scrollStep: Math.floor(initialMetrics.viewportHeight * 0.8), // 80% of viewport
				stabilityTimeout: Math.min(adjustedTimeout * 0.1, 5000), // 10% of timeout or 5s max
			});

			// Final lazy load check
			await PageManager.waitForLazyLoad(page, 2000);
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

import puppeteer, {
	type Browser,
	type PuppeteerLifeCycleEvent,
	type Page,
} from "puppeteer";
import { writeFile } from "node:fs/promises";
import type { ScreenshotOptions } from "./types";
import { PuppeteerBlocker } from "@cliqz/adblocker-puppeteer";
import fetch from "cross-fetch";

const autoconsent = require("@duckduckgo/autoconsent/dist/autoconsent.puppet.js");
const extraRules = require("@duckduckgo/autoconsent/rules/rules.json");

const consentomatic = extraRules.consentomatic;
const rules = [
	...autoconsent.rules,
	...Object.keys(consentomatic).map(
		(name) =>
			new autoconsent.ConsentOMaticCMP(`com_${name}`, consentomatic[name]),
	),
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	...extraRules.autoconsent.map((spec: any) => autoconsent.createAutoCMP(spec)),
];

export class ScreenshotService {
	private browser: Browser | null = null;
	private blocker: PuppeteerBlocker | null = null;

	constructor() {
		this.initialize();
	}

	private async initialize() {
		try {
			this.blocker = await PuppeteerBlocker.fromLists(fetch, [
				"https://secure.fanboy.co.nz/fanboy-cookiemonster.txt",
			]);

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
			console.error("Failed to initialize browser:", error);
			throw error;
		}
	}

	private async handleStickyElements(page: Page) {
		// Function to find and modify sticky elements
		await page.evaluate(() => {
			const modifyStickyElements = () => {
				// Store original styles for restoration
				const originalStyles: { element: Element; style: string }[] = [];

				// Query for elements with position: fixed or sticky
				const stickyElements = document.querySelectorAll<HTMLElement>(
					'[style*="position: fixed"], [style*="position:fixed"], ' +
						'[style*="position: sticky"], [style*="position:sticky"]',
				);

				// Also check computed styles for elements that might be set via CSS
				for (const element of Array.from(document.querySelectorAll("*"))) {
					const computedStyle = window.getComputedStyle(element);
					if (
						computedStyle.position === "fixed" ||
						computedStyle.position === "sticky"
					) {
						const stickyElementsArray = Array.from(stickyElements);
						for (const el of stickyElementsArray) {
							if (!stickyElementsArray.includes(el)) {
								stickyElementsArray.push(el);
							}
						}
					}
				}

				for (const element of Array.from(stickyElements)) {
					const computedStyle = window.getComputedStyle(element);
					if (
						computedStyle.position === "fixed" ||
						computedStyle.position === "sticky"
					) {
						originalStyles.push({
							element: element,
							style: element.style.cssText,
						});

						// Temporarily convert to static positioning
						element.style.setProperty("position", "static", "important");

						// If it's a header or navigation, move it to its natural position
						if (
							element.tagName.toLowerCase() === "header" ||
							element.tagName.toLowerCase() === "nav" ||
							element.getAttribute("role") === "navigation"
						) {
							element.style.setProperty("top", "0", "important");
							element.style.setProperty("z-index", "auto", "important");
						}
					}
				}

				// Return the original styles for restoration
				return originalStyles;
			};

			// Store the original styles in a global variable for restoration
			(
				window as {
					__originalStickyStyles?: { element: Element; style: string }[];
				}
			).__originalStickyStyles = modifyStickyElements();
		});
	}

	private async restoreStickyElements(page: Page) {
		// Restore the original styles of modified elements
		await page.evaluate(() => {
			const originalStyles = (
				window as {
					__originalStickyStyles?: { element: Element; style: string }[];
				}
			).__originalStickyStyles;
			if (originalStyles) {
				for (const { element, style } of originalStyles) {
					(element as HTMLElement).style.cssText = style;
				}
			}
		});
	}

	async takeScreenshot(options: ScreenshotOptions): Promise<Buffer | null> {
		if (!this.browser) {
			await this.initialize();
		}

		const {
			url,
			width = 1920,
			height = 1080,
			fullPage = true,
			quality = 80,
			format = "jpeg",
			waitUntil = "networkidle2",
			timeout = 30000,
			outputPath,
		} = options;

		try {
			console.log(`Taking screenshot of ${url}...`);
			const page = await this.browser?.newPage();

			if (!page) {
				throw new Error("Failed to create a new page");
			}

			if (this.blocker) {
				await this.blocker.enableBlockingInPage(page);
			}

			// Set viewport
			await page.setViewport({ width, height });

			page.once("load", async () => {
				const tab = autoconsent.attachToPage(page, url, rules, 10);
				try {
					await tab.checked;
					await tab.doOptIn();
				} catch (e) {
					console.warn("CMP error", e);
				}
			});

			// Set default timeout
			page.setDefaultTimeout(timeout);

			// Navigate to URL
			await page.goto(url, {
				waitUntil: waitUntil as PuppeteerLifeCycleEvent,
				timeout,
			});

			// Handle sticky elements before screenshot
			await this.handleStickyElements(page);

			// Wait a brief moment for any animations to settle
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Take screenshot
			const screenshot = await page.screenshot({
				fullPage,
				type: format,
				quality: format === "jpeg" ? quality : undefined,
			});

			// Restore sticky elements
			await this.restoreStickyElements(page);

			// Close the page to free up resources
			await page.close();

			// Save to file if outputPath is provided
			if (outputPath) {
				await writeFile(outputPath, screenshot);
				console.log(`Screenshot saved to ${outputPath}`);
			}

			return Buffer.from(screenshot);
		} catch (error) {
			console.error(`Screenshot failed for ${url}:`, error);
			return null;
		}
	}

	async cleanup() {
		if (this.browser) {
			await this.browser.close();
			this.browser = null;
		}
	}
}

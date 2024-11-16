import puppeteer, {
	type Browser,
	type PuppeteerLifeCycleEvent,
} from "puppeteer";
import { writeFile } from "node:fs/promises";
import type { ScreenshotOptions } from "./types";

export class ScreenshotService {
	private browser: Browser | null = null;

	constructor() {
		this.initialize();
	}

	private async initialize() {
		try {
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

			// Set viewport
			await page.setViewport({ width, height });

			// Set default timeout
			page.setDefaultTimeout(timeout);

			// Navigate to URL
			await page.goto(url, {
				waitUntil: waitUntil as PuppeteerLifeCycleEvent,
				timeout,
			});

			// Common selectors for cookie banners and privacy notices
			const commonSelectors = [
				// Cookie banners
				"#cookie-banner",
				".cookie-notice",
				'[class*="cookie"]',
				'[id*="cookie"]',
				// GDPR notices
				".privacy-notice",
				"#privacy-popup",
				'[class*="gdpr"]',
				'[id*="gdpr"]',
				// Common consent managers
				"#onetrust-banner-sdk",
				"#onetrust-consent-sdk",
				".cc-window",
				"#usercentrics-root",
				".qc-cmp2-container",
				"#sp-cc",
				// Generic overlays
				'[class*="popup"]',
				'[class*="modal"]',
				'[class*="overlay"]',
				// Generic alerts
				'[class*="banner"]',
				'[id*="banner"]',
				'[role="banner"]',
				'[class*="notification"]',
				'[id*="notification"]',
				'[class*="alert"]',
				'[id*="alert"]',
			];

			// Remove elements matching selectors
			await page.evaluate((selectors) => {
				for (const selector of selectors) {
					const elements = document.querySelectorAll(selector);
					for (const element of Array.from(elements)) {
						if (element instanceof HTMLElement) {
							// Check if element is visible
							const style = window.getComputedStyle(element);
							if (style.display !== "none" && style.visibility !== "hidden") {
								element.remove();
							}
						}
					}
				}
				// Remove fixed/sticky positioning and overflow hidden
				document.body.style.position = "static";
				document.body.style.overflow = "visible";
				document.documentElement.style.overflow = "visible";
			}, commonSelectors);

			// Small delay to ensure DOM updates are complete
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Take screenshot
			const screenshot = await page.screenshot({
				fullPage,
				type: format,
				quality: format === "jpeg" ? quality : undefined,
			});

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

import { ScreenshotService } from "./screenshot";

const run = async () => {
	const service = new ScreenshotService();

	try {
		const urls = [
			// "https://bun.sh",
			// "https://www.commonroom.io/product/customer-intelligence-platform/",
			"https://about.scarf.sh/",
			"https://about.scarf.sh/scarf-executive-investor-growth-metrics/",
		];
		const outputDir = "screenshots";

		for (const url of urls) {
			const screenshot = await service.takeScreenshot({
				url,
				outputPath: `${outputDir}/screenshot-${new Date().getTime()}.jpg`,
			});

			if (screenshot) {
				console.log(`Successfully captured screenshot of ${url}`);
			} else {
				console.error(`Failed to capture screenshot of ${url}`);
			}
		}
	} catch (error) {
		console.error("Error:", error);
	} finally {
		await service.cleanup();
		process.exit(0);
	}
};

// Handle process termination
process.on("SIGINT", async () => {
	console.log("\nGracefully shutting down...");
	const service = new ScreenshotService();
	await service.cleanup();
	process.exit(0);
});

process.on("SIGTERM", async () => {
	console.log("\nGracefully shutting down...");
	const service = new ScreenshotService();
	await service.cleanup();
	process.exit(0);
});

run().catch((error) => {
	console.error("Fatal error:", error);
	process.exit(1);
});

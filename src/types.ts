export interface ScreenshotOptions {
	url: string;
	width?: number;
	height?: number;
	fullPage?: boolean;
	quality?: number;
	format?: "jpeg" | "png";
	waitUntil?: "load" | "domcontentloaded" | "networkidle0" | "networkidle2";
	timeout?: number;
	outputPath?: string;
}

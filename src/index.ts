import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { ScreenshotService } from "./screenshot";
import { cors } from "hono/cors";

// Create validation schema for request body
const screenshotSchema = z.object({
  url: z.string().url(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fullPage: z.boolean().optional(),
  quality: z.number().int().min(1).max(100).optional(),
  format: z.enum(["jpeg", "png"]).optional(),
  waitUntil: z
    .enum(["load", "domcontentloaded", "networkidle0", "networkidle2"])
    .optional(),
  timeout: z.number().int().positive().optional(),
});

// Type for the validated request body
type ScreenshotRequest = z.infer<typeof screenshotSchema>;

// Create the Hono app
const app = new Hono();

// Initialize the screenshot service
const screenshotService = new ScreenshotService();

// Add CORS middleware
app.use("/*", cors());

// Health check endpoint
app.get("/health", (c) => c.json({ status: "ok" }));

// Screenshot endpoint
app.post("/screenshot", zValidator("json", screenshotSchema), async (c) => {
  try {
    const body: ScreenshotRequest = c.req.valid("json");

    const screenshot = await screenshotService.takeScreenshot({
      ...body,
      // Don't allow outputPath from API requests for security
      outputPath: undefined,
    });

    // Set appropriate content type based on format
    const contentType = body.format === "png" ? "image/png" : "image/jpeg";

    return new Response(screenshot, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": screenshot.length.toString(),
      },
    });
  } catch (error) {
    // Log the error for debugging
    console.error("Screenshot error:", error);

    // Return appropriate error response
    if (error instanceof Error) {
      return c.json(
        {
          error: "Failed to capture screenshot",
          message: error.message,
        },
        500
      );
    }
    return c.json(
      {
        error: "Internal server error",
        message: "An unexpected error occurred",
      },
      500
    );
  }
});

// Batch screenshot endpoint
app.post(
  "/screenshots/batch",
  zValidator(
    "json",
    z.object({
      urls: z.array(screenshotSchema),
    })
  ),
  async (c) => {
    try {
      const { urls } = c.req.valid("json");

      const results = await Promise.allSettled(
        urls.map((options) =>
          screenshotService.takeScreenshot({
            ...options,
            outputPath: undefined,
          })
        )
      );

      const response = results.map((result, index) => ({
        url: urls[index].url,
        success: result.status === "fulfilled",
        data:
          result.status === "fulfilled"
            ? result.value.toString("base64")
            : undefined,
        error: result.status === "rejected" ? result.reason.message : undefined,
      }));

      return c.json(response);
    } catch (error) {
      console.error("Batch screenshot error:", error);

      return c.json(
        {
          error: "Failed to process batch screenshot request",
          message:
            error instanceof Error
              ? error.message
              : "An unexpected error occurred",
        },
        500
      );
    }
  }
);

// Cleanup screenshot service on server shutdown
const cleanup = async () => {
  console.log("Cleaning up screenshot service...");
  await screenshotService.cleanup();
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Start the server
const port = process.env.PORT ? Number.parseInt(process.env.PORT) : 3000;
console.log(`Server starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

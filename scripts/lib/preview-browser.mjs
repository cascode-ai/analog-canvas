export function previewBrowserLaunchOptions(environment = process.env) {
  const executablePath =
    environment.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  return {
    headless: true,
    ...(executablePath ? { executablePath } : { channel: "chrome" }),
  };
}

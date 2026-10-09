import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Default config: pages are force-dynamic (fetch the Nuno API) and /methodology is prerendered,
// so no incremental cache bucket is needed.
export default defineCloudflareConfig({});

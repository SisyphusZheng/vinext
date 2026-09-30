export default {
  // Inline at build time. Only local E2E builds enable the preview and
  // revalidation test controls; deployed previews compile them to 404s.
  env: { VINEXT_E2E_CONTROLS: process.env.VINEXT_E2E_CONTROLS === "1" ? "1" : "" },
  async rewrites() {
    return {
      beforeFiles: [{ source: "/before/:path*", destination: "/:path*" }],
      afterFiles: [{ source: "/after/:path*", destination: "/:path*" }],
      fallback: [{ source: "/fallback/:path*", destination: "/:path*" }],
    };
  },
};
